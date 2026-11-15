using Classight.SharedKernel;

namespace Classight.Api.Updates;

internal sealed record UpdateStatus(string CurrentVersion, bool Supported, bool Enabled, string Platform,
    string Phase = "idle", string? LatestVersion = null, DateTimeOffset? LastCheckedAt = null,
    DateTimeOffset? NextCheckAt = null, long DownloadedBytes = 0, long TotalBytes = 0,
    string? ErrorCode = null, bool RestartRequired = false, bool BackupAvailable = false);

internal sealed class UpdateState(IConfiguration configuration, bool standalone)
{
    private readonly object gate = new();
    private readonly SemaphoreSlim requested = new(0, 1);
    private UpdateStatus status = new(ReleaseVersion.Current, false, true,
        OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsLinux() ? "linux" : "unsupported",
        standalone ? "idle" : "unsupported");

    public bool Enabled => configuration["Updates:Enabled"] is not { } setting || bool.TryParse(setting, out var value) && value;
    public TimeSpan Interval => TimeSpan.FromMinutes(Minutes("CheckIntervalMinutes", 360, 5, 10080));
    public TimeSpan RetryDelay => TimeSpan.FromMinutes(Minutes("RetryIntervalMinutes", 15, 1, 1440));
    public TimeSpan Timeout => TimeSpan.FromMinutes(Minutes("DownloadTimeoutMinutes", 10, 1, 60));
    private int Minutes(string key, int fallback, int min, int max) =>
        int.TryParse(configuration["Updates:" + key], out var value) ? Math.Clamp(value, min, max) : fallback;

    public UpdateStatus Snapshot { get { lock (gate) return status with { Enabled = Enabled }; } }
    public void Change(Func<UpdateStatus, UpdateStatus> change) { lock (gate) status = change(status); }

    public UpdateStatus RequestCheck()
    {
        lock (gate)
        {
            if (!status.Supported) throw new ApiException(409, "updates.unsupported", "当前运行方式不支持自动更新");
            if (!Enabled) throw new ApiException(409, "updates.disabled", "自动更新已在配置文件中关闭");
            if (status.RestartRequired || status.Phase is "queued" or "checking" or "downloading" or "installing")
                throw new ApiException(409, "updates.busy", "更新正在进行或等待重启");
            status = status with { Phase = "queued", ErrorCode = null, NextCheckAt = null };
            if (requested.CurrentCount == 0) requested.Release();
            return status with { Enabled = Enabled };
        }
    }

    public Task<bool> WaitAsync(TimeSpan delay, CancellationToken ct) => requested.WaitAsync(delay, ct);
}

internal static class UpdateEndpoints
{
    internal static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/admin/system/updates", (UpdateState updates) => updates.Snapshot)
            .RequireAuthorization("system.read").WithTags("System");
        endpoints.MapPost("/api/v1/admin/system/updates/check", (UpdateState updates) =>
            Results.Accepted("/api/v1/admin/system/updates", updates.RequestCheck()))
            .RequireAuthorization("system.manage").WithTags("System");
    }
}
