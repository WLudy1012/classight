using System.Diagnostics;
using System.Security.Cryptography;

namespace Classight.Api.Updates;

internal static class WindowsUpdateInstaller
{
    internal static async Task<int> RunAsync(string[] args)
    {
        if (!OperatingSystem.IsWindows() || args.Length != 5 || !int.TryParse(args[3], out var processId) ||
            !long.TryParse(args[4], out var startTicks) || args[2] != Path.GetFileName(args[2]) ||
            args[2].IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || !args[2].EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return 2;
        var root = Path.GetFullPath(args[1]);
        var directory = Path.Combine(root, "data", "updates");
        var metadata = Path.Combine(directory, "pending.json");
        var binary = Path.Combine(directory, "ClassightDaemon.pending.exe");
        var executable = Path.Combine(root, args[2]);
        var backup = Path.Combine(directory, "ClassightDaemon.previous.exe");
        var errorFile = Path.Combine(directory, "last-error.txt");
        try
        {
            if (!File.Exists(metadata)) return 0;
            if (processId > 0)
            {
                try
                {
                    using var process = Process.GetProcessById(processId);
                    if (process.StartTime.ToUniversalTime().Ticks == startTicks) await process.WaitForExitAsync();
                }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
            using var updateLock = new FileStream(Path.Combine(directory, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if (!File.Exists(metadata)) return 0;
            if (!File.Exists(executable) && File.Exists(backup)) File.Move(backup, executable);
            var config = new ConfigurationBuilder().AddEnvironmentVariables("ASPNETCORE_").AddEnvironmentVariables("DOTNET_");
            foreach (var name in new[] { "appsettings.json", "appsettings.Local.json" })
            {
                var path = Path.Combine(root, "config", name);
                config.AddJsonFile(File.Exists(path) ? path : Path.Combine(root, name), optional: true);
            }
            using var settings = (ConfigurationRoot)config.AddEnvironmentVariables().Build();
            if (settings["Updates:Enabled"] is { } setting && (!bool.TryParse(setting, out var enabled) || !enabled)) return 0;
            if (!File.Exists(executable)) throw new IOException("The installed executable is missing.");
            var current = VersionOf(executable);
            var pending = await ReleaseUpdateService.ReadPendingAsync(metadata, default);
            try
            {
                if (current is null || pending is null || pending.CurrentVersion != current.ToString() ||
                    !string.Equals(pending.ExecutableName ?? "ClassightDaemon.exe", args[2], StringComparison.OrdinalIgnoreCase) ||
                    ReleaseVersion.ParseStable(pending.Version) is not { } version || version <= current ||
                    !GitHubReleaseSource.IsSha256(pending.Sha256) || !File.Exists(binary) || VersionOf(binary) != version)
                    throw new InvalidDataException("The pending update no longer matches this installation.");
                await using var download = File.OpenRead(binary);
                var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(download));
                if (!string.Equals(hash, pending.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The pending update failed SHA-256 verification.");
            }
            catch (InvalidDataException)
            {
                File.Delete(metadata);
                File.Delete(binary);
                throw;
            }
            File.Replace(binary, executable, backup);
            File.Delete(metadata);
            File.Delete(errorFile);
            return 0;
        }
        catch (Exception exception)
        {
            try { await File.WriteAllTextAsync(errorFile, exception.Message); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return 1;
        }
    }

    private static Version? VersionOf(string path) => ReleaseVersion.ParseStable(
        ReleaseVersion.WithoutBuildMetadata(FileVersionInfo.GetVersionInfo(path).ProductVersion));
}
