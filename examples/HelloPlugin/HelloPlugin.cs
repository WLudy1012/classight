using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.HelloPlugin;

public sealed class HelloModule : IPluginModule
{
    private static readonly string Version = typeof(HelloModule).Assembly.GetName().Version?.ToString() ?? "1.0.0";
    public string Name => "Hello";
    public PluginManifest Manifest => new("hello", "Hello plugin", "A DLL with its own page and API", Version, WorkspacePath: "hello", Icon: "web", UiEntry: "/api/v1/plugins/hello/ui/index.html");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => [];
    public void AddServices(IServiceCollection services, IConfiguration configuration) => services.AddSingleton<IManagedPlugin>(new ManagedPlugin("hello", true));
    public void MapEndpoints(IEndpointRouteBuilder endpoints) => endpoints.MapGet("/api/v1/plugins/hello/api/status", () => new { message = "Hello from a dynamically loaded DLL", version = Version }).RequireAuthorization();
}
