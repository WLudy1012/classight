using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;

namespace Classight.Api.Updates;

internal sealed class ReleaseUpdateService(IHttpClientFactory clients, IConfiguration configuration,
    IHostEnvironment environment, ILogger<ReleaseUpdateService> logger) : BackgroundService
{
    private const string WindowsBinary = "ClassightDaemon-win-x64.exe";
    private const string LinuxBinary = "ClassightDaemon-linux-x64";
    private const string PendingFile = "ClassightDaemon.pending.exe";
    private static readonly JsonSerializerOptions PendingJson = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var executable = Environment.ProcessPath;
        var current = ReleaseVersion.ParseStable(ReleaseVersion.Current);
        var asset = OperatingSystem.IsWindows() ? WindowsBinary : OperatingSystem.IsLinux() ? LinuxBinary : null;
        if (current is null || asset is null || RuntimeInformation.ProcessArchitecture != Architecture.X64 ||
            executable is null || string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetDirectoryName(executable), Path.TrimEndingDirectorySeparator(environment.ContentRootPath),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) ||
            (OperatingSystem.IsWindows() && !string.Equals(Path.GetFileName(executable), "ClassightDaemon.exe", StringComparison.OrdinalIgnoreCase)))
            return;

        using var timer = new PeriodicTimer(Interval);
        try
        {
            do
            {
                try
                {
                    if (!configuration.GetValue("Updates:Enabled", true)) continue;
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    deadline.CancelAfter(TimeSpan.FromMinutes(5));
                    if (await CheckAsync(executable, current, asset, deadline.Token)) return;
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning(exception, "Classight update check failed. The running version is {Version}", current);
                }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private async Task<bool> CheckAsync(string executable, Version current, string asset, CancellationToken ct)
    {
        using var client = clients.CreateClient(GitHubReleaseSource.ClientName);
        var source = new GitHubReleaseSource(client);
        var release = await source.FindAsync(current, asset, ct);
        if (release is null) return false;

        var directory = Path.Combine(environment.ContentRootPath, "data", "updates");
        Directory.CreateDirectory(directory);
        using var updateLock = new FileStream(Path.Combine(directory, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);

        if (OperatingSystem.IsLinux() && !IsRunningLinuxImage(executable)) return true;
        var pendingBinary = Path.Combine(directory, PendingFile);
        var pendingMetadata = Path.Combine(directory, "pending.json");
        if (OperatingSystem.IsWindows() &&
            (ReadWindowsVersion(executable) != current || await IsPendingAsync(pendingMetadata, pendingBinary, current, release.Version, ct)))
            return false;

        var temporary = Path.Combine(directory, $"download-{Guid.NewGuid():N}.tmp");
        try
        {
            string checksum;
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
            {
                checksum = await source.DownloadAsync(release, output, ct);
                output.Flush(flushToDisk: true);
            }

            if (OperatingSystem.IsLinux())
            {
                if (InstallLinuxImage(temporary, executable))
                    logger.LogInformation("Classight {Version} is installed and will run after the next restart", release.Version);
                return true;
            }

            if (ReadWindowsVersion(temporary) != release.Version)
                throw new InvalidDataException("Release binary's ProductVersion does not match its GitHub tag.");

            var pending = new PendingUpdate(release.Version.ToString(), current.ToString(), checksum);
            await WritePendingAsync(temporary, pendingBinary, pendingMetadata, pending, ct);
            logger.LogInformation("Classight {Version} is ready to apply on the next Windows launcher startup", release.Version);
            return false;
        }
        finally { DeleteTemporary(temporary); }
    }

    private static Version? ReadWindowsVersion(string file) => ReleaseVersion.ParseStable(
        ReleaseVersion.WithoutBuildMetadata(FileVersionInfo.GetVersionInfo(file).ProductVersion));

    private static async Task<bool> IsPendingAsync(string metadata, string binary, Version current, Version latest, CancellationToken ct)
    {
        if (!File.Exists(metadata) || !File.Exists(binary) || new FileInfo(metadata).Length > 4096) return false;
        PendingUpdate? pending;
        try
        {
            await using var manifest = File.OpenRead(metadata);
            pending = await JsonSerializer.DeserializeAsync<PendingUpdate>(manifest, PendingJson, ct);
        }
        catch (JsonException) { return false; }

        if (pending is null || pending.CurrentVersion != current.ToString() || !GitHubReleaseSource.IsSha256(pending.Sha256) ||
            ReleaseVersion.ParseStable(pending.Version) is not { } version || version < latest)
            return false;
        await using var pendingFile = File.OpenRead(binary);
        var digest = Convert.ToHexStringLower(await SHA256.HashDataAsync(pendingFile, ct));
        return digest == pending.Sha256;
    }

    private static async Task WritePendingAsync(string temporary, string binary, string metadata, PendingUpdate pending, CancellationToken ct)
    {
        var metadataTemp = temporary + ".json";
        try
        {
            await File.WriteAllTextAsync(metadataTemp, JsonSerializer.Serialize(pending, PendingJson), ct);
            ct.ThrowIfCancellationRequested();
            File.Delete(metadata);
            File.Move(temporary, binary, overwrite: true);
            File.Move(metadataTemp, metadata);
        }
        finally { DeleteTemporary(metadataTemp); }
    }

    private static bool IsRunningLinuxImage(string executable) =>
        new FileInfo("/proc/self/exe").LinkTarget == executable && File.Exists(executable);

    [SupportedOSPlatform("linux")]
    private static bool InstallLinuxImage(string downloaded, string executable)
    {
        using (var binary = File.OpenRead(downloaded))
        {
            Span<byte> header = stackalloc byte[20];
            binary.ReadExactly(header);
            if (!header[..6].SequenceEqual(new byte[] { 0x7f, 0x45, 0x4c, 0x46, 2, 1 }) || header[18] != 0x3e || header[19] != 0)
                throw new InvalidDataException("Release binary is not a Linux x64 ELF executable.");
        }

        var sibling = executable + $".update-{Guid.NewGuid():N}";
        try
        {
            File.Copy(downloaded, sibling);
            if (!IsRunningLinuxImage(executable)) return false;
            var mode = File.GetUnixFileMode(executable);
            if ((mode & (UnixFileMode.SetUser | UnixFileMode.SetGroup)) != 0)
                throw new InvalidOperationException("Cannot replace an executable with setuid or setgid permissions.");
            File.SetUnixFileMode(sibling, mode);
            if (!IsRunningLinuxImage(executable)) return false;
            File.Move(sibling, executable, overwrite: true);
            return true;
        }
        finally { DeleteTemporary(sibling); }
    }

    private static void DeleteTemporary(string file)
    {
        try { File.Delete(file); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private sealed record PendingUpdate(string Version, string CurrentVersion, string Sha256);
}
