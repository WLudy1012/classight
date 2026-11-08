using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Classight.Api;
using Classight.Platform;
using Classight.Plugins;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class DaemonPluginTests
{
    [Fact]
    public void Installer_updates_recorded_bundled_files_and_preserves_manual_replacements_and_deletions()
    {
        var directory = Path.Combine(Path.GetTempPath(), "classight-installer-" + Guid.NewGuid().ToString("N"));
        try
        {
            BuiltinPluginInstaller.Ensure(directory);
            var speech = Path.Combine(directory, "Classight.Speech.dll");
            var original = File.ReadAllBytes(speech);
            var marker = Path.Combine(directory, ".bundled-plugins-installed");
            var seeded = JsonSerializer.Deserialize<Dictionary<string, string?>>(File.ReadAllText(marker))!;
            File.WriteAllText(speech, "previous bundled version");
            seeded["Classight.Speech.dll"] = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(speech)));
            File.WriteAllText(marker, JsonSerializer.Serialize(seeded));
            BuiltinPluginInstaller.Ensure(directory);
            Assert.Equal(original, File.ReadAllBytes(speech));
            File.WriteAllText(speech, "custom version");
            BuiltinPluginInstaller.Ensure(directory);
            Assert.Equal("custom version", File.ReadAllText(speech));
            File.Delete(speech);
            BuiltinPluginInstaller.Ensure(directory);
            Assert.False(File.Exists(speech));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task Builtin_dlls_are_loaded_and_meetings_can_be_removed_and_restored_without_data_loss()
    {
        await using var app = new ApiFactory();
        using var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        var runtime = app.Services.GetRequiredService<PluginRuntime>();
        Assert.Equal(new[] { "captcha", "meetings", "member-identity", "timetable" }, runtime.Manifests.Select(plugin => plugin.Id).Order().ToArray());
        Assert.Equal(4, runtime.Status.Count(status => status.State == "active"));
        var session = await Kit.OpenSession(admin);
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var member = await db.Roles.SingleAsync(role => role.Name == "Member");
            member.Permissions = member.Permissions.Where(code => code != "speech.participate").ToArray();
            await db.SaveChangesAsync();
        }
        var file = Path.Combine(runtime.DirectoryPath, "Classight.Speech.dll");
        var backup = file + ".disabled";
        File.Move(file, backup);
        await runtime.ReloadAsync();
        await Synchronize(app.Services);
        Assert.DoesNotContain(runtime.Manifests, plugin => plugin.Id == "meetings");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/v1/speech/sessions/{session}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/auth/me")).StatusCode);
        File.Move(backup, file);
        await runtime.ReloadAsync();
        await Synchronize(app.Services);
        Assert.Contains(runtime.Manifests, plugin => plugin.Id == "meetings");
        Assert.Equal(session, (await Kit.Json(await admin.GetAsync($"/api/v1/speech/sessions/{session}"))).GetProperty("id").GetGuid());
        await using var restoredScope = app.Services.CreateAsyncScope();
        var restoredMember = await restoredScope.ServiceProvider.GetRequiredService<AppDbContext>().Roles.SingleAsync(role => role.Name == "Member");
        Assert.DoesNotContain("speech.participate", restoredMember.Permissions);
    }

    [Fact]
    public async Task Missing_enabled_captcha_cannot_bypass_sign_in_verification()
    {
        await using var app = new ApiFactory();
        using var client = app.Client();
        _ = await Kit.Login(client, "admin", "IntegrationAdmin123!");
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var setting = await db.Settings.SingleOrDefaultAsync(item => item.Group == "plugin:captcha");
            if (setting is null) db.Settings.Add(new Setting { Group = "plugin:captcha", Json = "true" });
            else setting.Json = "true";
            await db.SaveChangesAsync();
        }
        var runtime = app.Services.GetRequiredService<PluginRuntime>();
        File.Delete(Path.Combine(runtime.DirectoryPath, "Classight.Captcha.dll"));
        await runtime.ReloadAsync();
        await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" }), HttpStatusCode.ServiceUnavailable, "plugin.unavailable");
    }

    private static Task Synchronize(IServiceProvider services) => DatabaseBootstrap.Initialize(services, services.GetRequiredService<IConfiguration>(), services.GetRequiredService<IHostEnvironment>(), CancellationToken.None);
}
