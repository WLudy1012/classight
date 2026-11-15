using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Classight.Api.Updates;
using Classight.SharedKernel;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class UpdateLifecycleTests
{
    [Fact]
    public async Task Manual_checks_require_authorization_and_a_supported_installation()
    {
        await using var app = new ApiFactory();
        using var client = app.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/admin/system/updates")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/admin/system/updates/check", null)).StatusCode);
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" });
        var credentials = await login.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", credentials.GetProperty("accessToken").GetString());
        var status = await client.GetFromJsonAsync<UpdateStatus>("/api/v1/admin/system/updates");
        Assert.False(status!.Supported);
        Assert.Equal(ReleaseVersion.Current, status.CurrentVersion);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync("/api/v1/admin/system/updates/check", null)).StatusCode);
        var system = await client.GetFromJsonAsync<JsonElement>("/api/v1/admin/system/status");
        Assert.Equal(ReleaseVersion.Current, system.GetProperty("version").GetString());

        var inviteResponse = await client.PostAsJsonAsync("/api/v1/admin/invites", new { role = "Member", maxUses = 1 });
        var invite = await inviteResponse.Content.ReadFromJsonAsync<JsonElement>();
        using var member = app.Client();
        var registration = await member.PostAsJsonAsync("/api/v1/auth/register", new { inviteCode = invite.GetProperty("code").GetString(), username = "updatemember", displayName = "成员", password = "MemberPassword123!" });
        var account = await registration.Content.ReadFromJsonAsync<JsonElement>();
        member.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account.GetProperty("accessToken").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/v1/admin/system/updates")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/api/v1/admin/system/updates/check", null)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_manual_checks_queue_once_and_cannot_bypass_disabled_updates()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var state = new UpdateState(config, true);
        state.Change(s => s with { Supported = true });
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() =>
        {
            try { state.RequestCheck(); return true; }
            catch (ApiException) { return false; }
        })));
        Assert.Single(outcomes, x => x);
        Assert.True(await state.WaitAsync(TimeSpan.Zero, default));
        Assert.False(await state.WaitAsync(TimeSpan.Zero, default));
        state.Change(s => s with { Phase = "idle" });
        config["Updates:Enabled"] = "false";
        Assert.Throws<ApiException>(() => state.RequestCheck());
        config["Updates:Enabled"] = "invalid";
        Assert.False(state.Enabled);
        config["Updates:Enabled"] = "true";
        state.Change(s => s with { RestartRequired = true });
        Assert.Throws<ApiException>(() => state.RequestCheck());
    }

    [Fact]
    public void Retry_and_download_intervals_have_bounded_defaults()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Updates:CheckIntervalMinutes"] = "-1", ["Updates:RetryIntervalMinutes"] = "0",
            ["Updates:DownloadTimeoutMinutes"] = "999999"
        }).Build();
        var state = new UpdateState(config, true);
        Assert.Equal(TimeSpan.FromMinutes(5), state.Interval);
        Assert.Equal(TimeSpan.FromMinutes(1), state.RetryDelay);
        Assert.Equal(TimeSpan.FromMinutes(60), state.Timeout);
        config["Updates:CheckIntervalMinutes"] = "invalid";
        Assert.Equal(TimeSpan.FromHours(6), state.Interval);
    }

    [Fact]
    public async Task Pending_metadata_is_atomic_and_cancellation_keeps_the_previous_installation()
    {
        var root = Path.Combine(Path.GetTempPath(), "classight-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var download = Path.Combine(root, "download.tmp");
            var binary = Path.Combine(root, "pending.exe");
            var metadata = Path.Combine(root, "pending.json");
            await File.WriteAllTextAsync(download, "new image");
            await File.WriteAllTextAsync(binary, "old image");
            await File.WriteAllTextAsync(metadata, "old metadata");
            var pending = new ReleaseUpdateService.PendingUpdate("1.1.0", "1.0.1", new string('a', 64), "ClassightDaemon.exe");
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ReleaseUpdateService.WritePendingAsync(download, binary, metadata, pending, new CancellationToken(true)));
            Assert.Equal("old image", await File.ReadAllTextAsync(binary));
            Assert.Equal("old metadata", await File.ReadAllTextAsync(metadata));
            await ReleaseUpdateService.WritePendingAsync(download, binary, metadata, pending, default);
            Assert.Equal("new image", await File.ReadAllTextAsync(binary));
            Assert.Equal(pending, await ReleaseUpdateService.ReadPendingAsync(metadata, default));
            Assert.False(File.Exists(metadata + ".tmp"));
            await File.WriteAllTextAsync(metadata, new string('x', 4097));
            Assert.Null(await ReleaseUpdateService.ReadPendingAsync(metadata, default));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public void Linux_installation_preserves_backup_and_mode_and_rejects_invalid_or_stale_images()
    {
        if (!OperatingSystem.IsLinux()) return;
        var root = Path.Combine(Path.GetTempPath(), "classight-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var binary = Path.Combine(root, "ClassightDaemon");
            var download = Path.Combine(root, "download.tmp");
            var backup = Path.Combine(root, "ClassightDaemon.previous");
            File.WriteAllText(binary, "previous image");
            var mode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead;
            File.SetUnixFileMode(binary, mode);
            var elf = new byte[64];
            new byte[] { 0x7f, 0x45, 0x4c, 0x46, 2, 1 }.CopyTo(elf, 0);
            elf[18] = 0x3e;
            File.WriteAllBytes(download, elf);
            Assert.False(ReleaseUpdateService.InstallLinuxImage(download, binary, backup, () => false));
            Assert.Equal("previous image", File.ReadAllText(binary));
            Assert.False(File.Exists(backup));
            Assert.True(ReleaseUpdateService.InstallLinuxImage(download, binary, backup, () => true));
            Assert.Equal(elf, File.ReadAllBytes(binary));
            Assert.Equal("previous image", File.ReadAllText(backup));
            Assert.Equal(mode, File.GetUnixFileMode(binary));
            elf[18] = 0xb7;
            File.WriteAllBytes(download, elf);
            Assert.Throws<InvalidDataException>(() =>
            {
                if (OperatingSystem.IsLinux()) ReleaseUpdateService.InstallLinuxImage(download, binary, backup, () => true);
            });
            Assert.Equal("previous image", File.ReadAllText(backup));
            Assert.Empty(Directory.EnumerateFiles(root, "*.update-*"));
        }
        finally { Directory.Delete(root, true); }
    }
}
