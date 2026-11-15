using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;

namespace Classight.Api.Updates;

internal sealed class ReleaseUpdateService(IHttpClientFactory clients, IHostEnvironment environment,
    UpdateState state, ILogger<ReleaseUpdateService> logger) : BackgroundService
{
    private const string WindowsBinary = "ClassightDaemon-win-x64.exe";
    private const string LinuxBinary = "ClassightDaemon-linux-x64";
    private const string PendingFile = "ClassightDaemon.pending.exe";
    private static readonly JsonSerializerOptions PendingJson = new(JsonSerializerDefaults.Web);
    private Process? installer;
    private string UpdateDirectory => Path.Combine(environment.ContentRootPath, "data", "updates");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var executable = Environment.ProcessPath;
        var current = ReleaseVersion.ParseStable(ReleaseVersion.Current);
        var asset = OperatingSystem.IsWindows() ? WindowsBinary : OperatingSystem.IsLinux() ? LinuxBinary : null;
        var supported = current is not null && asset is not null && RuntimeInformation.ProcessArchitecture == Architecture.X64 &&
            executable is not null && !string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(Path.GetDirectoryName(executable), Path.TrimEndingDirectorySeparator(environment.ContentRootPath),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
        state.Change(s => s with { Supported = supported, Phase = supported ? "idle" : "unsupported" });
        if (!supported) return;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var delay = state.Interval;
                if (state.Enabled)
                {
                    try
                    {
                        state.Change(s => s with { Phase = "checking", LastCheckedAt = DateTimeOffset.UtcNow,
                            NextCheckAt = null, ErrorCode = null, DownloadedBytes = 0, TotalBytes = 0 });
                        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                        deadline.CancelAfter(state.Timeout);
                        if (await CheckAsync(executable!, current!, asset!, deadline.Token)) return;
                        state.Change(s => s with { Phase = "current" });
                    }
                    catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                    {
                        delay = state.RetryDelay;
                        var code = exception switch
                        {
                            OperationCanceledException => "timeout",
                            HttpRequestException => "network",
                            InvalidDataException => "verification",
                            IOException or UnauthorizedAccessException => "filesystem",
                            _ => "install"
                        };
                        state.Change(s => s with { Phase = "error", ErrorCode = code });
                        logger.LogWarning(exception, "Classight update failed; retry in {Minutes} minutes", delay.TotalMinutes);
                    }
                }
                else state.Change(s => s with { Phase = "disabled" });
                state.Change(s => s with { NextCheckAt = state.Enabled ? DateTimeOffset.UtcNow + delay : null });
                await state.WaitAsync(delay, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { installer?.Dispose(); }
    }

    private async Task<bool> CheckAsync(string executable, Version current, string asset, CancellationToken ct)
    {
        var directory = UpdateDirectory;
        Directory.CreateDirectory(directory);
        using var updateLock = new FileStream(Path.Combine(directory, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var backup = Path.Combine(directory, OperatingSystem.IsWindows() ? "ClassightDaemon.previous.exe" : "ClassightDaemon.previous");
        state.Change(s => s with { BackupAvailable = File.Exists(backup) });
        foreach (var orphan in Directory.EnumerateFiles(directory, "download-*.tmp*")) DeleteTemporary(orphan);
        var pendingBinary = Path.Combine(directory, PendingFile);
        var pendingMetadata = Path.Combine(directory, "pending.json");

        if (OperatingSystem.IsWindows())
        {
            var pending = await ReadPendingAsync(pendingMetadata, ct);
            if (pending is not null && await IsPendingAsync(pending, pendingBinary, executable, current, ct))
            {
                StartWindowsInstaller(executable);
                Ready(pending.Version);
                return true;
            }
            if (ReadWindowsVersion(executable) != current)
            {
                Ready(ReadWindowsVersion(executable)?.ToString());
                return true;
            }
        }
        if (OperatingSystem.IsLinux() && !IsRunningLinuxImage(executable))
        {
            var installed = await ReadPendingAsync(Path.Combine(directory, "installed.json"), ct);
            Ready(installed?.Version);
            return true;
        }

        using var client = clients.CreateClient(GitHubReleaseSource.ClientName);
        var source = new GitHubReleaseSource(client);
        var release = await source.FindAsync(current, asset, ct);
        if (release is null) return false;
        state.Change(s => s with { LatestVersion = release.Version.ToString(), Phase = "downloading", TotalBytes = release.Size });
        var temporary = Path.Combine(directory, $"download-{Guid.NewGuid():N}.tmp");
        try
        {
            string checksum;
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
            {
                checksum = await source.DownloadAsync(release, output, ct,
                    bytes => state.Change(s => s with { DownloadedBytes = bytes }));
                output.Flush(flushToDisk: true);
            }
            ct.ThrowIfCancellationRequested();
            state.Change(s => s with { Phase = "installing" });
            var pending = new PendingUpdate(release.Version.ToString(), current.ToString(), checksum, Path.GetFileName(executable));
            if (OperatingSystem.IsLinux())
            {
                if (!InstallLinuxImage(temporary, executable, backup, () => IsRunningLinuxImage(executable)))
                    throw new IOException("The installed executable changed during the update.");
                Ready(release.Version.ToString());
                try { await WriteMetadataAsync(Path.Combine(directory, "installed.json"), pending, CancellationToken.None); }
                catch (IOException exception) { logger.LogWarning(exception, "The update is installed but its receipt could not be saved"); }
                return true;
            }
            if (ReadWindowsVersion(temporary) != release.Version)
                throw new InvalidDataException("Release binary's ProductVersion does not match its GitHub tag.");
            await WritePendingAsync(temporary, pendingBinary, pendingMetadata, pending, ct);
            StartWindowsInstaller(executable);
            Ready(release.Version.ToString());
            return true;
        }
        finally { DeleteTemporary(temporary); }
    }

    private void Ready(string? version)
    {
        state.Change(s => s with { Phase = "ready", LatestVersion = version, RestartRequired = true, NextCheckAt = null,
            BackupAvailable = File.Exists(Path.Combine(UpdateDirectory,
                OperatingSystem.IsWindows() ? "ClassightDaemon.previous.exe" : "ClassightDaemon.previous")) });
        logger.LogInformation("Classight {Version} is ready; restart the daemon to use it", version);
    }

    private void StartWindowsInstaller(string executable)
    {
        if (installer is { HasExited: false }) return;
        var helper = Path.Combine(UpdateDirectory, "ClassightDaemon.updater.exe");
        File.Copy(executable, helper, overwrite: true);
        var start = new ProcessStartInfo
        {
            FileName = helper,
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = environment.ContentRootPath
        };
        using var process = Process.GetCurrentProcess();
        start.Environment["DOTNET_BUNDLE_EXTRACT_BASE_DIR"] = Path.Combine(environment.ContentRootPath, "data", "bundle");
        foreach (var argument in new[] { "--apply-update", environment.ContentRootPath, Path.GetFileName(executable),
            Environment.ProcessId.ToString(), process.StartTime.ToUniversalTime().Ticks.ToString() })
            start.ArgumentList.Add(argument);
        installer?.Dispose();
        installer = Process.Start(start) ?? throw new IOException("Could not start the Windows update installer.");
    }

    private static Version? ReadWindowsVersion(string file) => ReleaseVersion.ParseStable(
        ReleaseVersion.WithoutBuildMetadata(FileVersionInfo.GetVersionInfo(file).ProductVersion));

    internal static async Task<PendingUpdate?> ReadPendingAsync(string metadata, CancellationToken ct)
    {
        if (!File.Exists(metadata) || new FileInfo(metadata).Length > 4096) return null;
        try
        {
            await using var manifest = File.OpenRead(metadata);
            return await JsonSerializer.DeserializeAsync<PendingUpdate>(manifest, PendingJson, ct);
        }
        catch (JsonException) { return null; }
    }

    private static async Task<bool> IsPendingAsync(PendingUpdate pending, string binary, string executable, Version current, CancellationToken ct)
    {
        if (!File.Exists(binary) || pending.CurrentVersion != current.ToString() || !GitHubReleaseSource.IsSha256(pending.Sha256) ||
            ReleaseVersion.ParseStable(pending.Version) is not { } version || version <= current ||
            !string.Equals(pending.ExecutableName ?? "ClassightDaemon.exe", Path.GetFileName(executable), StringComparison.OrdinalIgnoreCase) ||
            ReadWindowsVersion(binary) != version) return false;
        await using var pendingFile = File.OpenRead(binary);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(pendingFile, ct)) == pending.Sha256;
    }

    internal static async Task WritePendingAsync(string temporary, string binary, string metadata, PendingUpdate pending, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        File.Delete(metadata);
        File.Move(temporary, binary, overwrite: true);
        await WriteMetadataAsync(metadata, pending, ct);
    }

    private static async Task WriteMetadataAsync(string metadata, PendingUpdate pending, CancellationToken ct)
    {
        var temporary = metadata + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(pending, PendingJson), ct);
            ct.ThrowIfCancellationRequested();
            File.Move(temporary, metadata, overwrite: true);
        }
        finally { DeleteTemporary(temporary); }
    }

    private static bool IsRunningLinuxImage(string executable) =>
        new FileInfo("/proc/self/exe").LinkTarget == executable && File.Exists(executable);

    [SupportedOSPlatform("linux")]
    internal static bool InstallLinuxImage(string downloaded, string executable, string backup, Func<bool> isRunningImage)
    {
        using (var binary = File.OpenRead(downloaded))
        {
            Span<byte> header = stackalloc byte[20];
            binary.ReadExactly(header);
            if (!header[..6].SequenceEqual(new byte[] { 0x7f, 0x45, 0x4c, 0x46, 2, 1 }) || header[18] != 0x3e || header[19] != 0)
                throw new InvalidDataException("Release binary is not a Linux x64 ELF executable.");
        }
        var sibling = executable + $".update-{Guid.NewGuid():N}";
        var backupTemp = backup + ".tmp";
        try
        {
            if (!isRunningImage()) return false;
            var mode = File.GetUnixFileMode(executable);
            if ((mode & (UnixFileMode.SetUser | UnixFileMode.SetGroup)) != 0)
                throw new InvalidOperationException("Cannot replace an executable with setuid or setgid permissions.");
            File.Copy(downloaded, sibling);
            File.SetUnixFileMode(sibling, mode);
            using (var output = new FileStream(sibling, FileMode.Open, FileAccess.Write)) output.Flush(flushToDisk: true);
            File.Copy(executable, backupTemp, overwrite: true);
            using (var output = new FileStream(backupTemp, FileMode.Open, FileAccess.Write)) output.Flush(flushToDisk: true);
            File.Move(backupTemp, backup, overwrite: true);
            if (!isRunningImage()) return false;
            File.Move(sibling, executable, overwrite: true);
            return true;
        }
        finally { DeleteTemporary(sibling); DeleteTemporary(backupTemp); }
    }

    private static void DeleteTemporary(string file)
    {
        try { File.Delete(file); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    internal sealed record PendingUpdate(string Version, string CurrentVersion, string Sha256, string? ExecutableName = null);
}
