using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using Classight.Contracts;
using Classight.Plugins;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class PluginRuntimeTests
{
    private static string Fixture(bool second)
    {
        var testProject = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
#if DEBUG
        const string configuration = "Debug";
#else
        const string configuration = "Release";
#endif
        return Path.Combine(testProject, second ? "Classight.PluginFixture.V2" : "Classight.PluginFixture", "bin", configuration, "net11.0", "Classight.PluginFixture.dll");
    }

    [Fact]
    public async Task Real_dll_reloads_drain_requests_keep_failed_versions_and_release_collectible_contexts()
    {
        var root = Path.Combine(Path.GetTempPath(), "classight-hotload-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var plugins = Path.Combine(root, "plugin");
        var log = Path.Combine(root, "events.log");
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Plugins:Directory"] = plugins, ["Fixture:LogPath"] = log });
        builder.Services.AddClassightPluginRuntime(builder.Configuration, plugins);
        await using var app = builder.Build();
        app.UseClassightPlugins();
        var runtime = app.Services.GetRequiredService<PluginRuntime>();
        await runtime.InitializeAsync();
        Assert.True(Directory.Exists(plugins));
        var file = Path.Combine(plugins, "fixture.dll");
        File.Copy(Fixture(false), file);
        await runtime.ReloadAsync();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
        Assert.Equal("one", (await client.GetFromJsonAsync<Dictionary<string, string>>("/api/v1/plugins/fixture/api/value"))!["value"]);
        using (var echoed = await client.PostAsJsonAsync("/api/v1/plugins/fixture/api/echo", new Dictionary<string, string> { ["value"] = "request" }))
            Assert.Equal("request:one", (await echoed.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["value"]);
        var initialGeneration = runtime.Manifests.Single().Generation;
        builder.Configuration["Fixture:UnsafeBindings"] = "true";
        await runtime.ReloadAsync();
        Assert.Equal("reload_failed", runtime.Status.Single().State);
        Assert.Equal(initialGeneration, runtime.Manifests.Single().Generation);
        builder.Configuration["Fixture:UnsafeBindings"] = "false";
        Assert.True(await VerifyLease(runtime, "one"));
        var running = client.GetAsync("/api/v1/plugins/fixture/api/slow");
        await WaitFor(() => Task.FromResult(File.Exists(log + ".request-one") || running.IsCompleted));
        if (!File.Exists(log + ".request-one")) Assert.Fail($"Slow request did not enter plugin: {(int)(await running).StatusCode} {await (await running).Content.ReadAsStringAsync()}");
        File.Copy(Fixture(true), file, true);
        await runtime.ReloadAsync();
        Assert.Equal("two", (await client.GetFromJsonAsync<Dictionary<string, string>>("/api/v1/plugins/fixture/api/value"))!["value"]);
        Assert.Equal("one", (await (await running).Content.ReadFromJsonAsync<Dictionary<string, string>>())!["value"]);
        Assert.True(await VerifyLease(runtime, "two"));
        await WaitFor(() => Task.FromResult(File.Exists(log + ".stop-one")));
        var generation = runtime.Manifests.Single().Generation;
        File.Copy(Path.Combine(Path.GetDirectoryName(Fixture(false))!, "Classight.Contracts.dll"), file, true);
        await runtime.ReloadAsync();
        Assert.Equal(generation, runtime.Manifests.Single().Generation);
        Assert.Equal("reload_failed", runtime.Status.Single().State);
        await File.WriteAllTextAsync(file, "not a DLL");
        await runtime.ReloadAsync();
        Assert.Equal("two", (await client.GetFromJsonAsync<Dictionary<string, string>>("/api/v1/plugins/fixture/api/value"))!["value"]);
        Assert.Equal(generation, runtime.Manifests.Single().Generation);
        Assert.Equal("reload_failed", runtime.Status.Single().State);
        File.Delete(file);
        await runtime.ReloadAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/plugins/fixture/api/value")).StatusCode);
        await WaitFor(() => Task.FromResult(File.Exists(log + ".stop-two")));
        File.Copy(Fixture(false), file);
        await WaitFor(() => Task.FromResult(runtime.Manifests.Any(manifest => manifest.Version == "one")));
        Assert.Equal("one", (await client.GetFromJsonAsync<Dictionary<string, string>>("/api/v1/plugins/fixture/api/value"))!["value"]);
        File.Delete(file);
        await runtime.ReloadAsync();
        await app.StopAsync();
        await AssertUnloaded(runtime.UnloadedContexts);
        Directory.Delete(root, true);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static async Task<bool> VerifyLease(PluginRuntime runtime, string value)
    {
        Assert.True(runtime.TryAcquireService<IMemberPermissionVerifier>(out var lease));
        await using (lease) return await lease.Service.HasPermission(value, CancellationToken.None);
    }

    [Fact]
    public async Task A_replacement_in_another_directory_is_retried_after_the_conflicting_version_is_removed()
    {
        var root = Path.Combine(Path.GetTempPath(), "classight-hotload-conflict-" + Guid.NewGuid().ToString("N"));
        var plugins = Path.Combine(root, "plugin");
        var oldFile = Path.Combine(plugins, "z-current", "fixture.dll");
        var newFile = Path.Combine(plugins, "a-replacement", "fixture.dll");
        Directory.CreateDirectory(Path.GetDirectoryName(oldFile)!);
        Directory.CreateDirectory(Path.GetDirectoryName(newFile)!);
        File.Copy(Fixture(false), oldFile);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Logging.ClearProviders();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Plugins:Directory"] = plugins, ["Fixture:LogPath"] = Path.Combine(root, "events.log") });
        builder.Services.AddClassightPluginRuntime(builder.Configuration, plugins);
        await using var app = builder.Build();
        app.UseClassightPlugins();
        var runtime = app.Services.GetRequiredService<PluginRuntime>();
        await runtime.InitializeAsync();
        File.Copy(Fixture(true), newFile);
        await runtime.ReloadAsync(force: false);
        Assert.Equal("one", runtime.Manifests.Single().Version);
        Assert.Contains(runtime.Status, item => item.FileName.EndsWith(Path.Combine("a-replacement", "fixture.dll")) && item.State == "load_failed");
        File.Delete(oldFile);
        await runtime.ReloadAsync(force: false);
        await runtime.ReloadAsync(force: false);
        Assert.Equal("two", runtime.Manifests.Single().Version);
        File.Delete(newFile);
        await runtime.ReloadAsync(force: false);
        await AssertUnloaded(runtime.UnloadedContexts, 3);
        Directory.Delete(root, true);
    }

    private static async Task WaitFor(Func<Task<bool>> condition)
    {
        for (var i = 0; i < 200; i++) { if (await condition()) return; await Task.Delay(25); }
        Assert.Fail("Timed out waiting for plugin lifecycle event");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static async Task AssertUnloaded(IReadOnlyList<WeakReference> references, int minimumCount = 4)
    {
        Assert.True(references.Count >= minimumCount);
        await Task.Delay(2100);
        var json = new System.Text.Json.JsonSerializerOptions { TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver() };
        _ = System.Text.Json.JsonSerializer.Serialize(new HostJsonProbe("cleanup"), json);
        _ = System.Text.Json.JsonSerializer.Deserialize<HostJsonProbe>("{\"Value\":\"cleanup\"}", json);
        for (var i = 0; i < 20 && references.Any(r => r.IsAlive); i++)
        {
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); await Task.Delay(50);
        }
        Assert.All(references, reference => Assert.False(reference.IsAlive));
    }
    private sealed record HostJsonProbe(string Value);
}
