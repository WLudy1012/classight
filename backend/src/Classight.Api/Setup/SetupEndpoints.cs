using Classight.Identity;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.EntityFrameworkCore;

namespace Classight.Api.Setup;

/// <summary>While setup is unfinished everything except /api/v1/setup/** answers 503 setup.required.</summary>
public sealed class SetupGateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext http, SetupService setup)
    {
        var path = http.Request.Path;
        if (path.StartsWithSegments("/api/v1") && !path.StartsWithSegments("/api/v1/setup") && !await setup.IsReady(http.RequestAborted))
            throw new ApiException(503, "setup.required", "系统尚未完成初始化，请先完成首次设置");
        await next(http);
    }
}

public static class SetupEndpoints
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/setup").WithTags("Setup");
        group.MapGet("/status", (SetupService setup, CancellationToken ct) => setup.GetStatus(ct));

        group.MapPost("/database/test", async (DatabaseTestRequest body, SetupService setup, DatabaseConfig config, HttpContext http, CancellationToken ct) =>
        {
            setup.RequireToken(http);
            var status = await setup.GetStatus(ct);
            if (status.State != "needs_database") throw SetupService.Forbidden("数据库已经配置完成");
            var provider = SetupService.Normalize(body.Provider, config.AllowSqlite);
            var (message, version) = await setup.TestConnection(provider, body.ConnectionString ?? "", ct);
            return new { ok = true, message, serverVersion = version };
        });

        group.MapPost("/database", async (DatabaseTestRequest body, SetupService setup, DatabaseConfig config, HttpContext http, CancellationToken ct) =>
        {
            setup.RequireToken(http);
            var provider = SetupService.Normalize(body.Provider, config.AllowSqlite);
            return await setup.ApplyDatabase(provider, body.ConnectionString ?? "", ct);
        });

        group.MapPost("/admin", async (SetupAdminRequest body, SetupService setup, AppDbContext db, IdentityService identity, HttpContext http, CancellationToken ct) =>
        {
            setup.RequireToken(http);
            var status = await setup.GetStatus(ct);
            if (status.State == "needs_database") throw new ApiException(409, "resource.conflict", "请先配置数据库");
            if (status.State != "needs_admin") throw SetupService.Forbidden("管理员账号已经创建");
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            if (await db.Users.AnyAsync(ct)) throw SetupService.Forbidden("管理员账号已经创建");
            var role = await db.Roles.SingleAsync(x => x.Name == "SuperAdmin" && !x.Deleted, ct);
            var user = await identity.NewUser(body.Username ?? "", string.IsNullOrWhiteSpace(body.DisplayName) ? body.Username ?? "" : body.DisplayName, body.Password ?? "", body.Email, [role], ct);
            await db.SaveChangesAsync(ct);
            await SystemState.WriteSetupCompleted(db, false, ct);
            var response = await identity.SignIn(user, http, ct);
            await transaction.CommitAsync(ct);
            return response;
        });

        group.MapPost("/complete", async (SetupService setup, CancellationToken ct) =>
        {
            var status = await setup.GetStatus(ct);
            if (status.SetupCompleted) throw SetupService.Forbidden("系统已完成初始化");
            await setup.Complete(ct);
            return Results.NoContent();
        }).RequireAuthorization("system.manage");
    }
}
