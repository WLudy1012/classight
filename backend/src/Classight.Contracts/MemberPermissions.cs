using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Contracts;

public interface IMemberPermissionVerifier
{
    Task<bool> HasPermission(string permission, CancellationToken ct);
    Task RequirePermission(string permission, CancellationToken ct);
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
