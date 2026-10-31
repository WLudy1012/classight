using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Identity;

public sealed class IdentityModule : IModule
{
    public string Name => "Identity";
    public IEnumerable<PermissionDefinition> DeclarePermissions() => new[] { "users.read", "users.manage", "roles.manage", "invites.manage" }.Select(x => new PermissionDefinition(x, Name, x));
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<IdentityService>();
        services.AddScoped<CaptchaService>();
        services.AddSingleton<IManagedPlugin, CaptchaPlugin>();
        var dataProtection = services.AddDataProtection();
        var keyDirectory = configuration["DataProtection:KeyDirectory"];
        if (!string.IsNullOrWhiteSpace(keyDirectory))
            dataProtection.SetApplicationName("Classight").PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
        services.AddHttpClient("captcha");
        services.AddScoped<IIdentityQueries>(sp => sp.GetRequiredService<IdentityService>());
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/api/v1/auth").WithTags("Auth");
        auth.MapGet("/captcha", (CaptchaService captcha, CancellationToken ct) => captcha.Public(ct));
        auth.MapPost("/login", async (LoginRequest body, IdentityService service, CaptchaService captcha, HttpContext http, CancellationToken ct) => { await captcha.Verify(body.Captcha, http, ct); return await service.Login(body, http, ct); });
        auth.MapPost("/register", async (RegisterRequest body, IdentityService service, CaptchaService captcha, AppDbContext db, ISiteSettingsReader settings, IClock clock, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            await captcha.Verify(body.Captcha, http, ct);
            if ((await settings.Get<SecuritySettings>("security", ct)).RegistrationMode != "invite") throw ApiException.Forbidden();
            var code = Input.Required(body.InviteCode, "inviteCode", 64);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var invite = await db.Invites.SingleOrDefaultAsync(x => x.Code == code && !x.Deleted, ct) ?? throw new ApiException(422, "invite.invalid", "邀请码无效");
            if (invite.ExpiresAt <= clock.UtcNow) throw new ApiException(410, "invite.expired", "邀请码已过期");
            if (invite.UsedCount >= invite.MaxUses) throw new ApiException(422, "invite.invalid", "邀请码使用次数已耗尽");
            var role = await db.Roles.SingleOrDefaultAsync(x => x.Id == invite.RoleId && !x.Deleted, ct) ?? throw new ApiException(422, "invite.invalid", "邀请角色已失效");
            var user = await service.NewUser(body.Username, body.DisplayName, body.Password, body.Email, [role], ct);
            invite.UsedCount++;
            await db.SaveChangesAsync(ct);
            var response = await service.SignIn(user, http, ct);
            await events.Publish(new("user.registered", "User", user.Id.ToString(), null, service.Self(user), new UserRegistered(user.Id)), ct);
            await transaction.CommitAsync(ct);
            return response;
        });
        auth.MapPost("/refresh", (IdentityService service, HttpContext http, CancellationToken ct) => service.Refresh(http, ct));
        auth.MapGet("/me", async (IdentityService service, CancellationToken ct) => service.Self(await service.RequireUser(ct))).RequireAuthorization();
        auth.MapPost("/logout", async (AppDbContext db, ICurrentUser user, HttpContext http, CancellationToken ct) =>
        {
            var session = await db.Sessions.SingleAsync(x => x.Id == user.SessionId, ct);
            session.Revoked = true; await db.SaveChangesAsync(ct); IdentityService.DeleteCookie(http); return Results.NoContent();
        }).RequireAuthorization();
        auth.MapPost("/logout-all", async (IdentityService service, AppDbContext db, ICurrentUser user, HttpContext http, CancellationToken ct) =>
        {
            await service.RevokeSessions(user.Id!.Value, null, ct); await db.SaveChangesAsync(ct); IdentityService.DeleteCookie(http); return Results.NoContent();
        }).RequireAuthorization();
        auth.MapPost("/password/change", async (ChangePasswordRequest body, IdentityService service, AppDbContext db, ICurrentUser current, IEventBus events, CancellationToken ct) =>
        {
            var user = await service.RequireUser(ct);
            if (!service.Verify(user, body.CurrentPassword)) throw new ApiException(401, "auth.invalid_credentials", "当前密码错误");
            await service.ValidatePassword(body.NewPassword, ct); service.SetPassword(user, body.NewPassword);
            await service.RevokeSessions(user.Id, current.SessionId, ct); await db.SaveChangesAsync(ct);
            await events.Publish(new("user.password_changed", "User", user.Id.ToString(), null, null), ct);
            return Results.NoContent();
        }).RequireAuthorization();
        auth.MapGet("/sessions", async (AppDbContext db, ICurrentUser user, IClock clock, CancellationToken ct) => await db.Sessions.AsNoTracking().Where(x => x.UserId == user.Id && !x.Revoked && x.ExpiresAt > clock.UtcNow).OrderByDescending(x => x.LastSeenAt).Select(x => new { x.Id, x.Device, x.Ip, x.CreatedAt, x.LastSeenAt, current = x.Id == user.SessionId }).ToListAsync(ct)).RequireAuthorization();
        auth.MapDelete("/sessions/{id:guid}", async (Guid id, AppDbContext db, ICurrentUser user, HttpContext http, CancellationToken ct) =>
        {
            var session = await db.Sessions.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.Id, ct) ?? throw ApiException.NotFound();
            session.Revoked = true; await db.SaveChangesAsync(ct);
            if (id == user.SessionId) IdentityService.DeleteCookie(http);
            return Results.NoContent();
        }).RequireAuthorization();
        var me = endpoints.MapGroup("/api/v1/me").WithTags("Me").RequireAuthorization();
        me.MapGet("/profile", async (IdentityService service, CancellationToken ct) => service.Self(await service.RequireUser(ct)));
        me.MapPatch("/profile", async (ProfileRequest body, IdentityService service, HttpContext http, CancellationToken ct) =>
        {
            var user = await service.RequireUser(ct); await service.UpdateProfile(user, body, http, ct); return service.Self(user);
        });
        me.MapGet("/console", async (IdentityService service, IClassProfileQueries classes, AppDbContext db, ICurrentUser current, CancellationToken ct) =>
        {
            var user = await service.RequireUser(ct);
            var shortcuts = new[] {
                new { key = "profile", label = "console.profile", route = "/console/profile", permission = (string?)null },
                new { key = "security", label = "console.security", route = "/console/security", permission = (string?)null },
                new { key = "class", label = "console.classInfo", route = "/class", permission = (string?)null },
                new { key = "admin", label = "console.admin", route = "/admin", permission = (string?)"site.settings.read" },
                new { key = "center", label = "center.title", route = "/center", permission = (string?)null },
                new { key = "admin-users", label = "console.adminUsers", route = "/admin/users", permission = (string?)"users.read" }
            }.Where(x => x.permission is null || current.Can(x.permission));
            return new { user = service.Self(user), linkedMember = await classes.GetLinkedMember(user.Id, ct), shortcuts, unreadNotifications = await db.Notifications.CountAsync(x => x.UserId == user.Id && x.ReadAt == null, ct) };
        });
        MapAdmin(endpoints);
        var captchaAdmin = endpoints.MapGroup("/api/v1/admin/plugins/captcha/config").WithTags("Captcha").RequireAuthorization();
        captchaAdmin.MapGet("", async (CaptchaService captcha, CancellationToken ct) => { var c = await captcha.Read(ct); return new { c.Provider, c.SiteKey, c.SceneId, c.Region, c.AccessKeyId, secretConfigured = !string.IsNullOrEmpty(c.Secret), appSecretConfigured = !string.IsNullOrEmpty(c.AppSecret) }; }).RequireAuthorization("site.settings.read");
        captchaAdmin.MapPut("", async (CaptchaConfigInput input, CaptchaService captcha, CancellationToken ct) => { await captcha.Save(input, ct); return Results.NoContent(); }).RequireAuthorization("site.settings.write");
    }
    private static void MapAdmin(IEndpointRouteBuilder endpoints)
    {
        var users = endpoints.MapGroup("/api/v1/admin/users").WithTags("Admin Users").RequireAuthorization();
        users.MapGet("", async (IdentityService service, HttpContext http, CancellationToken ct) =>
        {
            var query = service.Users.Where(x => !x.Deleted); var request = http.Request;
            if (request.Query.TryGetValue("q", out var q)) { var search = q.ToString(); query = query.Where(x => x.Username.Contains(search) || x.DisplayName.Contains(search)); }
            if (request.Query.TryGetValue("role", out var role)) { var value = role.ToString(); query = query.Where(x => x.UserRoles.Any(r => r.Role.Name == value)); }
            if (request.Query.TryGetValue("status", out var status))
            {
                if (status != "active" && status != "disabled") throw ApiException.Validation("status", "须为 active 或 disabled");
                var disabled = status == "disabled"; query = query.Where(x => x.Disabled == disabled);
            }
            var (page, size) = Input.Paging(request); var total = await query.CountAsync(ct);
            var items = await QuerySort.Apply(query, request, "-createdAt", new Dictionary<string, string> { ["createdAt"] = "CreatedAt", ["username"] = "Username", ["displayName"] = "DisplayName", ["name"] = "DisplayName" }).Skip((page - 1) * size).Take(size).ToListAsync(ct);
            return new Page<AdminUserView>(items.Select(service.Admin).ToArray(), total, page, size);
        }).RequireAuthorization("users.read");
        users.MapGet("/{id:guid}", async (Guid id, IdentityService service, CancellationToken ct) =>
        {
            var user = await service.Users.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            return service.Admin(user);
        }).RequireAuthorization("users.read");
        users.MapPost("", async (UserCreateRequest body, IdentityService service, AppDbContext db, IEventBus events, CancellationToken ct) =>
        {
            var names = body.Roles?.Distinct().ToArray() ?? [];
            if (names.Length == 0) names = ["Member"];
            var roles = await db.Roles.Where(x => names.Contains(x.Name) && !x.Deleted).ToListAsync(ct);
            if (roles.Count != names.Length) throw ApiException.Validation("roles", "角色不存在");
            await service.GuardRoles(roles, ct);
            var temporaryPassword = body.Password is null ? "Aa1!" + IdentityService.NewToken()[..20] : null;
            var user = await service.NewUser(body.Username, body.DisplayName, body.Password ?? temporaryPassword!, body.Email, roles, ct);
            await db.SaveChangesAsync(ct);
            await events.Publish(new("user.created", "User", user.Id.ToString(), null, service.Self(user), new UserRegistered(user.Id)), ct);
            var view = service.Admin(user); return Results.Created($"/api/v1/admin/users/{user.Id}", new { view.Id, view.Username, view.DisplayName, view.Email, view.AvatarUrl, view.Roles, view.Status, view.CreatedAt, view.LastLoginAt, view.Version, temporaryPassword });
        }).RequireAuthorization("users.manage");
        users.MapPatch("/{id:guid}", async (Guid id, ProfileRequest body, IdentityService service, HttpContext http, CancellationToken ct) =>
        {
            var user = await service.Users.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            await service.GuardManage(user, ct); await service.UpdateProfile(user, body, http, ct); return service.Self(user);
        }).RequireAuthorization("users.manage");
        foreach (var action in new[] { "disable", "enable", "reset-password" })
        {
            users.MapPost("/{id:guid}/" + action, async (Guid id, VersionRequest? body, IdentityService service, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
            {
                var user = await service.Users.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
                await service.GuardManage(user, ct); if (body?.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body?.Version, user.Version);
                var before = new { user.Disabled }; string? temporaryPassword = null;
                if (action == "disable") { await service.GuardLastAdmin(user, ct); user.Disabled = true; }
                else if (action == "enable") user.Disabled = false;
                else { temporaryPassword = "Aa1!" + IdentityService.NewToken()[..24]; service.SetPassword(user, temporaryPassword); }
                if (action != "enable") await service.RevokeSessions(user.Id, null, ct);
                await db.SaveChangesAsync(ct);
                await events.Publish(new("user." + action, "User", user.Id.ToString(), before, new { user.Disabled }, action == "disable" ? new UserDisabled(user.Id) : null), ct);
                return action == "reset-password" ? Results.Ok(new { temporaryPassword, user = service.Admin(user) }) : Results.Ok(service.Admin(user));
            }).RequireAuthorization("users.manage");
        }
        users.MapPut("/{id:guid}/roles", async (Guid id, RoleAssignment body, IdentityService service, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var user = await service.Users.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            await service.GuardManage(user, ct); if (body.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body.Version, user.Version);
            var ids = body.RoleIds?.Distinct().ToArray() ?? []; var roles = await db.Roles.Where(x => ids.Contains(x.Id) && !x.Deleted).ToListAsync(ct);
            if (roles.Count != ids.Length || roles.Count == 0) throw ApiException.Validation("roleIds", "必须指定有效角色");
            await service.GuardRoles(roles, ct);
            if (user.UserRoles.Any(x => x.Role.Name == "SuperAdmin") && roles.All(x => x.Name != "SuperAdmin")) await service.GuardLastAdmin(user, ct);
            var before = service.Self(user);
            db.UserRoles.RemoveRange(user.UserRoles.Where(x => !ids.Contains(x.RoleId)));
            foreach (var role in roles.Where(x => user.UserRoles.All(r => r.RoleId != x.Id))) user.UserRoles.Add(new() { User = user, UserId = user.Id, Role = role, RoleId = role.Id });
            db.Entry(user).Property(x => x.Version).IsModified = true;
            await service.RevokeSessions(user.Id, null, ct); await db.SaveChangesAsync(ct);
            await events.Publish(new("user.roles_changed", "User", id.ToString(), before, service.Self(user), new UserRolesChanged(id)), ct);
            return Results.NoContent();
        }).RequireAuthorization("users.manage");
        users.MapDelete("/{id:guid}", async (Guid id, IdentityService service, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var user = await service.Users.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            await service.GuardManage(user, ct); await service.GuardLastAdmin(user, ct); if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, user.Version);
            user.Deleted = true; await service.RevokeSessions(id, null, ct);
            foreach (var member in await db.Members.Where(x => x.UserId == id).ToListAsync(ct)) member.UserId = null;
            await db.SaveChangesAsync(ct); await events.Publish(new("user.deleted", "User", id.ToString(), service.Self(user), null), ct); return Results.NoContent();
        }).RequireAuthorization("users.manage");
        MapRolesAndInvites(endpoints);
    }
    private static void MapRolesAndInvites(IEndpointRouteBuilder endpoints)
    {
        var roles = endpoints.MapGroup("/api/v1/admin/roles").WithTags("Roles").RequireAuthorization("roles.manage");
        roles.MapGet("", async (AppDbContext db, CancellationToken ct) => await db.Roles.AsNoTracking().Where(x => !x.Deleted).OrderBy(x => x.Name).ToListAsync(ct));
        roles.MapGet("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) => await db.Roles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound());
        roles.MapPost("", async (RoleRequest body, AppDbContext db, IPermissionCatalog catalog, IdentityService identity, IEventBus events, CancellationToken ct) =>
        {
            var role = new Role(); await ApplyRole(role, body, db, catalog, identity, ct); db.Roles.Add(role); await db.SaveChangesAsync(ct);
            await events.Publish(new("role.created", "Role", role.Id.ToString(), null, role), ct); return Results.Created($"/api/v1/admin/roles/{role.Id}", role);
        });
        roles.MapPut("/{id:guid}", async (Guid id, RoleRequest body, AppDbContext db, IPermissionCatalog catalog, IdentityService identity, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var role = await db.Roles.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            if (body.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body.Version, role.Version);
            if (role.Name == "SuperAdmin") throw ApiException.Conflict("SuperAdmin 权限不可修改");
            if (role.BuiltIn && role.Name != body.Name) throw ApiException.Conflict("内置角色不可重命名");
            var before = new { role.Name, role.Description, role.Permissions };
            await ApplyRole(role, body, db, catalog, identity, ct); await db.SaveChangesAsync(ct);
            await events.Publish(new("role.updated", "Role", role.Id.ToString(), before, role), ct); return role;
        });
        roles.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var role = await db.Roles.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, role.Version);
            if (role.BuiltIn || await db.UserRoles.AnyAsync(x => x.RoleId == id, ct) || await db.Invites.AnyAsync(x => x.RoleId == id && !x.Deleted, ct)) throw ApiException.Conflict("内置或仍被使用的角色不可删除");
            role.Deleted = true; await db.SaveChangesAsync(ct); await events.Publish(new("role.deleted", "Role", id.ToString(), role, null), ct); return Results.NoContent();
        });
        endpoints.MapGet("/api/v1/admin/permissions", (IPermissionCatalog catalog) => catalog.All.GroupBy(x => x.Module).Select(x => new { module = x.Key, permissions = x.ToArray() })).RequireAuthorization("roles.manage").WithTags("Roles");
        var invites = endpoints.MapGroup("/api/v1/admin/invites").WithTags("Invites").RequireAuthorization("invites.manage");
        invites.MapGet("", async (AppDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var page = await QuerySort.Page(db.Invites.AsNoTracking().Where(x => !x.Deleted), http.Request, ct);
            var names = await db.Roles.ToDictionaryAsync(x => x.Id, x => x.Name, ct);
            return new Page<object>(page.Items.Select(x => (object)new { x.Id, x.Code, role = names[x.RoleId], x.MaxUses, expiresAt = x.ExpiresAt.Year >= 9999 ? (DateTimeOffset?)null : x.ExpiresAt, x.UsedCount, x.Version, x.CreatedAt }).ToArray(), page.Total, page.Number, page.PageSize);
        });
        invites.MapPost("", async (InviteRequest body, AppDbContext db, IdentityService identity, IClock clock, IEventBus events, CancellationToken ct) =>
        {
            if (body.MaxUses is < 1 or > 10000 || (body.ExpiresAt is { } expiry && expiry <= clock.UtcNow)) throw ApiException.Validation("expiresAt", "使用次数须为 1–10000，到期时间（填写时）须在未来");
            var role = await db.Roles.SingleOrDefaultAsync(x => x.Name == body.Role && !x.Deleted, ct) ?? throw ApiException.Validation("role", "角色不存在");
            await identity.GuardRoles([role], ct);
            var code = body.Code is null ? IdentityService.NewToken()[..24] : Input.Required(body.Code, "code", 64);
            if (code.Length < 12) throw ApiException.Validation("code", "邀请码至少 12 位");
            if (await db.Invites.AnyAsync(x => x.Code == code, ct)) throw ApiException.Conflict("邀请码已存在");
            var invite = new Invite { Code = code, RoleId = role.Id, MaxUses = body.MaxUses, ExpiresAt = (body.ExpiresAt ?? DateTimeOffset.MaxValue).ToUniversalTime() };
            db.Invites.Add(invite); await db.SaveChangesAsync(ct);
            await events.Publish(new("invite.created", "Invite", invite.Id.ToString(), null, new { invite.Id, role = role.Name, invite.MaxUses, invite.ExpiresAt }), ct);
            return Results.Created($"/api/v1/admin/invites/{invite.Id}", new { invite.Id, invite.Code, role = role.Name, invite.MaxUses, expiresAt = invite.ExpiresAt.Year >= 9999 ? (DateTimeOffset?)null : invite.ExpiresAt, invite.UsedCount, invite.Version });
        });
        invites.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var invite = await db.Invites.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, invite.Version); invite.Deleted = true; await db.SaveChangesAsync(ct);
            await events.Publish(new("invite.deleted", "Invite", id.ToString(), new { invite.Id }, null), ct); return Results.NoContent();
        });
    }
    private static async Task ApplyRole(Role role, RoleRequest body, AppDbContext db, IPermissionCatalog catalog, IdentityService identity, CancellationToken ct)
    {
        var name = Input.Required(body.Name, "name", 64);
        if (await db.Roles.AnyAsync(x => x.Id != role.Id && x.Name == name, ct)) throw ApiException.Conflict("角色名称已存在");
        var permissions = body.Permissions?.Distinct().ToArray() ?? [];
        if (permissions.Except(catalog.All.Select(x => x.Code)).Any()) throw ApiException.Validation("permissions", "包含未注册的权限码");
        var candidate = new Role { Name = name, Permissions = permissions }; await identity.GuardRoles([candidate], ct);
        role.Name = name; role.Description = Input.Optional(body.Description, "description") ?? ""; role.Permissions = permissions;
    }
}
