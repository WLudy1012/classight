using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Classight.Identity;

public record UserSelf(Guid Id, string Username, string DisplayName, string? AvatarUrl, string? Email, string Bio, string[] Roles, string[] Permissions, DateTimeOffset CreatedAt, long Version);
public record AdminUserView(Guid Id, string Username, string DisplayName, string? Email, string? AvatarUrl, string[] Roles, string Status, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, long Version);
public record LoginRequest(string Account, string Password, CaptchaProof? Captcha = null);
public record RegisterRequest(string InviteCode, string Username, string DisplayName, string Password, string? Email, CaptchaProof? Captcha = null);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record ProfileRequest(string? DisplayName, string? Bio, string? Email, long? Version);
public record RoleAssignment(Guid[] RoleIds, long? Version);
public record UserCreateRequest(string Username, string DisplayName, string? Password, string? Email, string[] Roles);
public record VersionRequest(long? Version);
public record RoleRequest(string Name, string? Description, string[] Permissions, long? Version);
public record InviteRequest(string? Code, string Role, int MaxUses, DateTimeOffset? ExpiresAt);

public sealed class IdentityService(AppDbContext db, ISiteSettingsReader settings, IConfiguration config, IClock clock, ICurrentUser current, IEventBus events, IJwtKeyProvider jwtKeys) : IIdentityQueries
{
    public const string CookieName = "classight.refresh";
    private readonly PasswordHasher<User> hasher = new(new Microsoft.Extensions.Options.OptionsWrapper<PasswordHasherOptions>(new() { IterationCount = 210000 }));
    public IQueryable<User> Users => db.Users.Include(x => x.UserRoles).ThenInclude(x => x.Role);
    public async Task<User> RequireUser(CancellationToken ct) => await Users.SingleOrDefaultAsync(x => x.Id == current.Id && !x.Deleted, ct) ?? throw ApiException.NotFound();
    public UserSelf Self(User user) => new(user.Id, user.Username, user.DisplayName, user.AvatarId is { } avatar ? $"/api/v1/media/{avatar}" : null, user.Email, user.Bio, user.UserRoles.Where(x => !x.Role.Deleted).Select(x => x.Role.Name).ToArray(), Permissions(user), user.CreatedAt, user.Version);
    public AdminUserView Admin(User user) => new(user.Id, user.Username, user.DisplayName, user.Email, user.AvatarId is { } avatar ? $"/api/v1/media/{avatar}" : null, user.UserRoles.Where(x => !x.Role.Deleted).Select(x => x.Role.Name).ToArray(), user.Disabled ? "disabled" : "active", user.CreatedAt, user.LastLoginAt, user.Version);
    public static string[] Permissions(User user) => user.UserRoles.Where(x => !x.Role.Deleted).SelectMany(x => x.Role.Permissions).Distinct().Order().ToArray();
    public async Task<UserSummary?> GetUser(Guid id, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct);
        return user is null ? null : new(user.Id, user.Username, user.DisplayName, user.AvatarId is { } avatar ? $"/api/v1/media/{avatar}" : null);
    }
    public async Task ValidatePassword(string password, CancellationToken ct)
    {
        var policy = await settings.Get<SecuritySettings>("security", ct);
        if (string.IsNullOrEmpty(password) || password.Length < policy.MinPasswordLength || password.Length > 128 || !password.Any(char.IsLetter) || !password.Any(char.IsDigit))
            throw new ApiException(422, "password.too_weak", $"密码需为 {policy.MinPasswordLength}–128 位，包含字母和数字");
    }
    public void SetPassword(User user, string password) { user.PasswordHash = hasher.HashPassword(user, password); user.FailedAttempts = 0; user.LockedUntil = null; }
    public bool Verify(User user, string? password) => !string.IsNullOrEmpty(password) && password.Length <= 128 && hasher.VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;
    public async Task<User> NewUser(string username, string displayName, string password, string? email, IReadOnlyList<Role> roles, CancellationToken ct)
    {
        username = Input.Required(username, "username", 64);
        if (!System.Text.RegularExpressions.Regex.IsMatch(username, "^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,63}$")) throw ApiException.Validation("username", "用户名须为 3–64 位字母、数字、下划线、点或连字符");
        email = Input.Email(email);
        var normalized = username.ToUpperInvariant(); var normalizedEmail = email?.ToUpperInvariant();
        if (await db.Users.AnyAsync(x => x.NormalizedUsername == normalized || normalizedEmail != null && x.NormalizedEmail == normalizedEmail, ct)) throw new ApiException(409, "user.already_exists", "用户名或邮箱已被使用");
        await ValidatePassword(password, ct);
        var user = new User { Username = username, NormalizedUsername = normalized, DisplayName = Input.Required(displayName, "displayName", 100), Email = email, NormalizedEmail = normalizedEmail, CreatedAt = clock.UtcNow };
        SetPassword(user, password);
        user.UserRoles = roles.Select(role => new UserRole { User = user, UserId = user.Id, Role = role, RoleId = role.Id }).ToList();
        db.Users.Add(user);
        return user;
    }
    public async Task<object> Login(LoginRequest request, HttpContext context, CancellationToken ct)
    {
        var account = Input.Required(request.Account, "account", 254).ToUpperInvariant();
        var user = await Users.SingleOrDefaultAsync(x => !x.Deleted && (x.NormalizedUsername == account || x.NormalizedEmail == account), ct);
        if (user?.LockedUntil > clock.UtcNow) throw new ApiException(423, "auth.account_locked", "账号暂时锁定，请稍后重试");
        if (user is null || !Verify(user, request.Password))
        {
            if (user is not null)
            {
                user.FailedAttempts++;
                if (user.FailedAttempts >= 5) user.LockedUntil = clock.UtcNow.AddMinutes(15);
                await db.SaveChangesAsync(ct);
            }
            else hasher.HashPassword(new User(), "timing-equalization-password");
            throw new ApiException(401, "auth.invalid_credentials", "账号或密码错误");
        }
        if (user.Disabled) throw new ApiException(403, "auth.account_disabled", "账号已禁用");
        user.FailedAttempts = 0; user.LockedUntil = null; user.LastLoginAt = clock.UtcNow;
        return await SignIn(user, context, ct);
    }
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public static string NewToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(48));
    public async Task<object> SignIn(User user, HttpContext context, CancellationToken ct)
    {
        var policy = await settings.Get<SecuritySettings>("security", ct);
        var token = NewToken();
        var session = new Session { UserId = user.Id, RefreshHash = Hash(token), ExpiresAt = clock.UtcNow.AddHours(policy.SessionHours), LastSeenAt = clock.UtcNow, CreatedAt = clock.UtcNow, Device = context.Request.Headers.UserAgent.ToString()[..Math.Min(context.Request.Headers.UserAgent.ToString().Length, 300)], Ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown" };
        db.Sessions.Add(session); await db.SaveChangesAsync(ct);
        SetCookie(context, token, session.ExpiresAt);
        var (accessToken, expiresIn) = AccessToken(user, session, policy.AccessTokenMinutes);
        return new { accessToken, expiresIn, user = Self(user) };
    }
    public async Task<object> Refresh(HttpContext context, CancellationToken ct)
    {
        var raw = context.Request.Cookies[CookieName];
        if (string.IsNullOrEmpty(raw) || raw.Length > 200) throw new ApiException(401, "auth.token_invalid", "刷新令牌无效");
        var hash = Hash(raw);
        var used = await db.UsedRefreshTokens.SingleOrDefaultAsync(x => x.Hash == hash, ct);
        if (used is not null)
        {
            var previous = await db.Sessions.SingleOrDefaultAsync(x => x.Id == used.SessionId, ct);
            if (previous is not null) { previous.Revoked = true; await db.SaveChangesAsync(ct); }
            DeleteCookie(context);
            throw new ApiException(401, "auth.token_invalid", "检测到刷新令牌重放，会话已撤销");
        }
        var session = await db.Sessions.SingleOrDefaultAsync(x => x.RefreshHash == hash, ct);
        if (session is null || session.Revoked) throw new ApiException(401, "auth.token_invalid", "刷新令牌无效");
        if (session.ExpiresAt <= clock.UtcNow) throw new ApiException(401, "auth.token_expired", "会话已过期");
        var user = await Users.SingleAsync(x => x.Id == session.UserId, ct);
        if (user.Disabled || user.Deleted) throw new ApiException(403, "auth.account_disabled", "账号已禁用");
        var next = NewToken();
        db.UsedRefreshTokens.Add(new() { SessionId = session.Id, Hash = hash, CreatedAt = clock.UtcNow });
        session.RefreshHash = Hash(next); session.LastSeenAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
        SetCookie(context, next, session.ExpiresAt);
        var policy = await settings.Get<SecuritySettings>("security", ct);
        var (accessToken, expiresIn) = AccessToken(user, session, policy.AccessTokenMinutes);
        return new { accessToken, expiresIn };
    }
    private (string, int) AccessToken(User user, Session session, int minutes)
    {
        var claims = new List<Claim> { new(JwtRegisteredClaimNames.Sub, user.Id.ToString()), new("sid", session.Id.ToString()), new(JwtRegisteredClaimNames.Jti, Guid.CreateVersion7().ToString()) };
        var token = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"], claims, clock.UtcNow.UtcDateTime, clock.UtcNow.AddMinutes(minutes).UtcDateTime, new SigningCredentials(new SymmetricSecurityKey(jwtKeys.KeyBytes), SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), minutes * 60);
    }
    public static void SetCookie(HttpContext context, string value, DateTimeOffset expiry) => context.Response.Cookies.Append(CookieName, value, new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/api/v1/auth", Expires = expiry, IsEssential = true });
    public static void DeleteCookie(HttpContext context) => context.Response.Cookies.Delete(CookieName, new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/api/v1/auth" });
    public async Task RevokeSessions(Guid userId, Guid? except, CancellationToken ct)
    {
        foreach (var session in await db.Sessions.Where(x => x.UserId == userId && !x.Revoked && x.Id != except).ToListAsync(ct)) session.Revoked = true;
    }
    public async Task UpdateProfile(User user, ProfileRequest request, HttpContext context, CancellationToken ct)
    {
        Input.Version(context, request.Version, user.Version);
        var before = Self(user);
        if (request.DisplayName is not null) user.DisplayName = Input.Required(request.DisplayName, "displayName", 100);
        if (request.Bio is not null) user.Bio = Input.Optional(request.Bio, "bio")!;
        if (request.Email is not null)
        {
            var email = Input.Email(request.Email); var normalized = email?.ToUpperInvariant();
            if (normalized is not null && await db.Users.AnyAsync(x => x.Id != user.Id && x.NormalizedEmail == normalized, ct)) throw new ApiException(409, "user.already_exists", "邮箱已被使用");
            user.Email = email; user.NormalizedEmail = normalized;
        }
        await db.SaveChangesAsync(ct);
        await events.Publish(new("user.updated", "User", user.Id.ToString(), before, Self(user)), ct);
    }
    public async Task GuardManage(User target, CancellationToken ct)
    {
        var actor = await RequireUser(ct);
        if (target.UserRoles.Any(x => x.Role.Name == "SuperAdmin") && !actor.UserRoles.Any(x => x.Role.Name == "SuperAdmin")) throw ApiException.Forbidden();
        if (Permissions(target).Except(Permissions(actor)).Any()) throw ApiException.Forbidden();
    }
    public async Task GuardRoles(IEnumerable<Role> roles, CancellationToken ct)
    {
        var actor = await RequireUser(ct);
        if (roles.SelectMany(x => x.Permissions).Except(Permissions(actor)).Any()) throw ApiException.Forbidden();
        if (roles.Any(x => x.Name == "SuperAdmin") && !actor.UserRoles.Any(x => x.Role.Name == "SuperAdmin")) throw ApiException.Forbidden();
    }
    public async Task GuardLastAdmin(User target, CancellationToken ct)
    {
        if (target.Id == current.Id) throw ApiException.Conflict("不能通过此接口禁用、删除或降级当前账号");
        if (target.UserRoles.Any(x => x.Role.Name == "SuperAdmin") && !await db.Users.AnyAsync(x => x.Id != target.Id && !x.Deleted && !x.Disabled && x.UserRoles.Any(r => r.Role.Name == "SuperAdmin"), ct)) throw ApiException.Conflict("必须保留至少一个可用的 SuperAdmin");
    }
}
