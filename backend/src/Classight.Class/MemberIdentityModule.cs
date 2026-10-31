using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Class;

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

public static class MemberPermissionEndpointExtensions
{
    public static RouteHandlerBuilder RequireMemberPermission(this RouteHandlerBuilder route, string permission)
    {
        route.RequireAuthorization();
        route.AddEndpointFilter(async (context, next) =>
        {
            var verifier = context.HttpContext.RequestServices.GetRequiredService<IMemberPermissionVerifier>();
            await verifier.RequirePermission(permission, context.HttpContext.RequestAborted);
            return await next(context);
        });
        return route;
    }
}

public sealed class MemberIdentityModule : IModule
{
    public string Name => "MemberIdentity";
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
