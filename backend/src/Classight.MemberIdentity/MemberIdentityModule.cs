using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.MemberIdentity;

public sealed class MemberPermissionVerifier(PluginStateStore plugins, IPermissionCatalog catalog, ICurrentUser user) : IMemberPermissionVerifier
{
    public async Task<bool> HasPermission(string permission, CancellationToken ct) =>
        await plugins.IsEnabled("member-identity", ct) && user.Id is not null &&
        catalog.All.Any(item => item.Code == permission) && user.Can(permission);

    public async Task RequirePermission(string permission, CancellationToken ct)
    {
        if (!await HasPermission(permission, ct)) throw ApiException.Forbidden();
    }
}

public sealed class MemberIdentityModule : IPluginModule
{
    public string Name => "MemberIdentity";
    public PluginManifest Manifest => new("member-identity", "Member permissions", "Shared permission verification for plugins", "1.0.0", WorkspacePath: "identity", Category: "account", Icon: "shield");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => [];
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<IMemberPermissionVerifier, MemberPermissionVerifier>();
        services.AddSingleton<IManagedPlugin>(new ManagedPlugin("member-identity", false));
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/member-identity/permissions", async (PluginStateStore plugins, IPermissionCatalog catalog, ICurrentUser user, CancellationToken ct) =>
        {
            if (!await plugins.IsEnabled("member-identity", ct)) throw ApiException.NotFound();
            return new { permissions = catalog.All.Where(p => user.Can(p.Code)).Select(p => p.Code).ToArray() };
        }).RequireAuthorization();
    }
}
