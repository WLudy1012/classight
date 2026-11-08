using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Classight.PluginFixture;

public sealed class FixtureModule : IPluginModule
{
#if VERSION_TWO
    public const string Value = "two";
#else
    public const string Value = "one";
#endif
    public string Name => "Fixture";
    public PluginManifest Manifest => new("fixture", "Fixture", "Reload test", Value, "fixture");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => [new("fixture.read", Name, "Read fixture")];
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IManagedPlugin>(new ManagedPlugin("fixture", true));
        services.AddScoped<IMemberPermissionVerifier, FixtureVerifier>();
        services.AddHostedService<FixtureWorker>();
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/plugins/fixture/api/value", () => new FixtureResult(Value));
        if (endpoints.ServiceProvider.GetRequiredService<IConfiguration>()["Fixture:UnsafeBindings"] == "true")
            endpoints.MapPost("/api/v1/plugins/fixture/api/echo", (FixtureInput input) => new FixtureResult(input.Value + ":" + Value));
        else endpoints.MapPost("/api/v1/plugins/fixture/api/echo", ([FromBody] FixtureInput input) => new FixtureResult(input.Value + ":" + Value));
        endpoints.MapGet("/api/v1/plugins/fixture/api/slow", async (HttpContext http) =>
        {
            var path = http.RequestServices.GetRequiredService<IConfiguration>()["Fixture:LogPath"]!;
            await File.WriteAllTextAsync(path + ".request-" + Value, "started");
            await Task.Delay(500);
            return new FixtureResult(Value);
        });
    }
}

public sealed record FixtureResult(string Value);
public sealed record FixtureInput(string Value);
public sealed class FixtureVerifier : IMemberPermissionVerifier
{
    public Task<bool> HasPermission(string permission, CancellationToken ct) => Task.FromResult(permission == FixtureModule.Value);
    public Task RequirePermission(string permission, CancellationToken ct) => HasPermission(permission, ct).ContinueWith(t => { if (!t.Result) throw ApiException.Forbidden(); }, ct);
}
public sealed class FixtureWorker(IConfiguration configuration) : IHostedService
{
    public Task StartAsync(CancellationToken ct) => File.WriteAllTextAsync(configuration["Fixture:LogPath"]! + ".start-" + FixtureModule.Value, "started", ct);
    public Task StopAsync(CancellationToken ct) => File.WriteAllTextAsync(configuration["Fixture:LogPath"]! + ".stop-" + FixtureModule.Value, "stopped", ct);
}
