using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Classight.Platform;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "classight-tests-" + Guid.NewGuid().ToString("N"));
    /// <summary>This factory's temp directory (database file and media storage).</summary>
    public string Root => root;
    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(root);
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Database:Provider"] = "Sqlite", ["ConnectionStrings:Main"] = "Data Source=" + Path.Combine(root, "test.db"),
            ["Jwt:Key"] = Classight.SharedKernel.JwtKeyProvider.DevelopmentDefault,
            ["Jwt:Issuer"] = "classight", ["Jwt:Audience"] = "classight-web",
            ["Bootstrap:Username"] = "admin", ["Bootstrap:Password"] = "IntegrationAdmin123!", ["Storage:LocalPath"] = Path.Combine(root, "media"),
            ["RateLimit:AuthPerMinute"] = "1000", ["RateLimit:GeneralPerMinute"] = "10000"
        }));
    }
    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false, AllowAutoRedirect = false });
}
public sealed class ApiTests
{
    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}"); return JsonDocument.Parse(text).RootElement.Clone();
    }
    private static async Task<(string Token, string Cookie, JsonElement User)> Login(HttpClient client, string account = "admin", string password = "IntegrationAdmin123!")
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { account, password }); var json = await Json(response);
        return (json.GetProperty("accessToken").GetString()!, response.Headers.GetValues("Set-Cookie").Single().Split(';')[0], json.GetProperty("user"));
    }
    private static void Bearer(HttpClient client, string token) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode); Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement; Assert.Equal(code, json.GetProperty("code").GetString()); Assert.False(string.IsNullOrWhiteSpace(json.GetProperty("traceId").GetString())); Assert.True(json.TryGetProperty("errors", out _));
    }
    [Fact]
    public async Task Public_contract_pagination_cache_and_protected_routes()
    {
        await using var app = new ApiFactory(); using var client = app.Client();
        var response = await client.GetAsync("/api/v1/site/public"); var site = await Json(response);
        Assert.Equal("v1", site.GetProperty("apiVersion").GetString()); Assert.Equal(JsonValueKind.False, site.GetProperty("features").GetProperty("redis").ValueKind); Assert.NotNull(response.Headers.ETag);
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/site/public"); request.Headers.IfNoneMatch.Add(response.Headers.ETag!); Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(request)).StatusCode);
        var members = await Json(await client.GetAsync("/api/v1/class/members")); Assert.Equal(1, members.GetProperty("page").GetInt32()); Assert.Equal(20, members.GetProperty("pageSize").GetInt32()); Assert.False(members.TryGetProperty("pageNumber", out _));
        await AssertProblem(await client.GetAsync("/api/v1/class/members?page=0"), HttpStatusCode.BadRequest, "validation.failed");
        await AssertProblem(await client.GetAsync("/api/v1/class/members?sort=passwordHash"), HttpStatusCode.BadRequest, "validation.failed");
        await AssertProblem(await client.GetAsync("/api/v1/admin/users"), HttpStatusCode.Unauthorized, "auth.token_invalid");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode); Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }
    [Fact]
    public async Task Refresh_rotation_replay_revokes_the_session_and_logout_invalidates_access()
    {
        await using var app = new ApiFactory(); using var client = app.Client(); var login = await Login(client);
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" });
        var cookie = response.Headers.GetValues("Set-Cookie").Single(); Assert.Contains("secure", cookie); Assert.Contains("httponly", cookie); Assert.Contains("samesite=strict", cookie); Assert.Contains("path=/api/v1/auth", cookie);
        var refresh = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh"); refresh.Headers.Add("Cookie", login.Cookie); var refreshed = await client.SendAsync(refresh); var payload = await Json(refreshed); Assert.False(payload.TryGetProperty("refreshToken", out _));
        var replay = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh"); replay.Headers.Add("Cookie", login.Cookie); await AssertProblem(await client.SendAsync(replay), HttpStatusCode.Unauthorized, "auth.token_invalid");
        Bearer(client, payload.GetProperty("accessToken").GetString()!); await AssertProblem(await client.GetAsync("/api/v1/auth/me"), HttpStatusCode.Unauthorized, "auth.token_invalid");
        var next = await Login(client); Bearer(client, next.Token); var logout = await client.PostAsync("/api/v1/auth/logout", null); Assert.True(logout.StatusCode == HttpStatusCode.NoContent, $"{logout.StatusCode}: {await logout.Content.ReadAsStringAsync()}"); await AssertProblem(await client.GetAsync("/api/v1/auth/me"), HttpStatusCode.Unauthorized, "auth.token_invalid");
    }
    [Fact]
    public async Task Invite_registration_permissions_and_optimistic_concurrency()
    {
        await using var app = new ApiFactory(); using var admin = app.Client(); var root = await Login(admin); Bearer(admin, root.Token);
        var invite = await Json(await admin.PostAsJsonAsync("/api/v1/admin/invites", new { role = "Member", maxUses = 1, expiresAt = DateTimeOffset.UtcNow.AddDays(1) }));
        using var member = app.Client(); var body = new { inviteCode = invite.GetProperty("code").GetString(), username = "student1", displayName = "同学", password = "StudentPass123!", email = "student@example.com" };
        var registered = await Json(await member.PostAsJsonAsync("/api/v1/auth/register", body)); Bearer(member, registered.GetProperty("accessToken").GetString()!);
        Assert.Equal(new[] { "media.upload", "speech.participate" }, registered.GetProperty("user").GetProperty("permissions").EnumerateArray().Select(x => x.GetString()));
        await AssertProblem(await member.GetAsync("/api/v1/admin/users"), HttpStatusCode.Forbidden, "permission.denied");
        await AssertProblem(await member.PostAsJsonAsync("/api/v1/auth/register", body), HttpStatusCode.UnprocessableEntity, "invite.invalid");
        var profile = await Json(await member.GetAsync("/api/v1/me/profile")); var version = profile.GetProperty("version").GetInt64();
        var changed = await Json(await member.PatchAsJsonAsync("/api/v1/me/profile", new { displayName = "新名字", version })); Assert.True(changed.GetProperty("version").GetInt64() > version);
        await AssertProblem(await member.PatchAsJsonAsync("/api/v1/me/profile", new { displayName = "覆盖", version }), HttpStatusCode.Conflict, "resource.version_mismatch");
        await AssertProblem(await member.PatchAsJsonAsync("/api/v1/me/profile", new { displayName = "缺版本" }), HttpStatusCode.BadRequest, "validation.failed");
        var userId = profile.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/admin/users/{userId}/disable", new { version = changed.GetProperty("version").GetInt64() })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await member.GetAsync("/api/v1/auth/me")).StatusCode);
        await AssertProblem(await member.PostAsJsonAsync("/api/v1/auth/login", new { account = "student1", password = "StudentPass123!" }), HttpStatusCode.Forbidden, "auth.account_disabled");
    }
    [Fact]
    public async Task Class_crud_binding_settings_audit_and_openapi()
    {
        await using var app = new ApiFactory(); using var client = app.Client(); var login = await Login(client); Bearer(client, login.Token);
        var member = await Json(await client.PostAsJsonAsync("/api/v1/admin/class/members", new { displayName = "测试成员", role = "student", intro = "介绍" })); var id = member.GetProperty("id").GetGuid();
        var linked = await Json(await client.PostAsJsonAsync($"/api/v1/admin/class/members/{id}/link-user", new { userId = login.User.GetProperty("id").GetGuid(), version = 1 }));
        var console = await Json(await client.GetAsync("/api/v1/me/console")); Assert.Equal(id, console.GetProperty("linkedMember").GetProperty("id").GetGuid());
        var timeline = await Json(await client.PostAsJsonAsync("/api/v1/admin/class/timeline", new { title = "开学", summary = "新的开始", body = "# 开学", occurredOn = "2026-09-01", tags = new[] { "学校" }, media = Array.Empty<Guid>() }));
        var overview = await Json(await client.GetAsync("/api/v1/class/overview")); Assert.Equal(1, overview.GetProperty("stats").GetProperty("memberCount").GetInt32()); Assert.Equal(1, overview.GetProperty("latestTimeline").GetArrayLength());
        var site = await Json(await client.GetAsync("/api/v1/admin/settings/site"));
        await Json(await client.PutAsJsonAsync("/api/v1/admin/settings/site", new { className = "新班级", slogan = "我们的班级", version = site.GetProperty("version").GetInt64() }));
        var security = await Json(await client.GetAsync("/api/v1/admin/settings/security"));
        await Json(await client.PutAsJsonAsync("/api/v1/admin/settings/security", new { classInfoPublic = false, version = security.GetProperty("version").GetInt64() }));
        using var anonymous = app.Client(); Assert.Equal("新班级", (await Json(await anonymous.GetAsync("/api/v1/site/public"))).GetProperty("className").GetString()); await AssertProblem(await anonymous.GetAsync("/api/v1/class/overview"), HttpStatusCode.Unauthorized, "auth.token_invalid");
        var logs = await Json(await client.GetAsync("/api/v1/admin/audit-logs?action=member.link-user")); Assert.Equal(1, logs.GetProperty("total").GetInt32());
        var openapi = await Json(await client.GetAsync("/openapi/v1.json")); Assert.True(openapi.GetProperty("paths").TryGetProperty("/api/v1/auth/login", out _));
        var delete = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/admin/class/members/{id}"); delete.Headers.TryAddWithoutValidation("If-Match", linked.GetProperty("version").ToString()); Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(delete)).StatusCode);
        await AssertProblem(await client.GetAsync($"/api/v1/class/members/{id}"), HttpStatusCode.NotFound, "resource.not_found");
    }
    [Fact]
    public async Task Media_private_public_and_invalid_type()
    {
        await using var app = new ApiFactory(); using var client = app.Client(); var login = await Login(client); Bearer(client, login.Token);
        var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=");
        using var form = new MultipartFormDataContent(); var file = new ByteArrayContent(bytes); file.Headers.ContentType = new("image/png"); form.Add(file, "file", "tiny.png");
        var media = await Json(await client.PostAsync("/api/v1/media", form)); var url = media.GetProperty("url").GetString()!;
        Assert.Equal(bytes, await client.GetByteArrayAsync(url)); using var anonymous = app.Client(); await AssertProblem(await anonymous.GetAsync(url), HttpStatusCode.NotFound, "resource.not_found");
        using var invalid = new MultipartFormDataContent(); var fake = new StringContent("<script>alert(1)</script>"); fake.Headers.ContentType = new("image/png"); invalid.Add(fake, "file", "fake.png"); await AssertProblem(await client.PostAsync("/api/v1/media", invalid), HttpStatusCode.UnprocessableEntity, "media.unsupported_type");
    }
    [Fact]
    public async Task Admin_cannot_escalate_to_superadmin_and_system_roles_cannot_be_deleted()
    {
        await using var app = new ApiFactory(); using var root = app.Client(); Bearer(root, (await Login(root)).Token);
        await Json(await root.PostAsJsonAsync("/api/v1/admin/users", new { username = "manager", displayName = "Manager", password = "ManagerPass123!", roles = new[] { "Admin" } }));
        using var manager = app.Client(); Bearer(manager, (await Login(manager, "manager", "ManagerPass123!")).Token);
        await AssertProblem(await manager.PostAsJsonAsync("/api/v1/admin/users", new { username = "evil", displayName = "Evil", password = "ManagerPass123!", roles = new[] { "SuperAdmin" } }), HttpStatusCode.Forbidden, "permission.denied");
        await AssertProblem(await manager.PostAsJsonAsync("/api/v1/admin/invites", new { role = "SuperAdmin", maxUses = 1, expiresAt = DateTimeOffset.UtcNow.AddDays(1) }), HttpStatusCode.Forbidden, "permission.denied");
        var roles = await Json(await root.GetAsync("/api/v1/admin/roles")); var member = roles.EnumerateArray().Single(x => x.GetProperty("name").GetString() == "Member");
        var delete = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/admin/roles/" + member.GetProperty("id").GetString()); delete.Headers.TryAddWithoutValidation("If-Match", "1"); await AssertProblem(await root.SendAsync(delete), HttpStatusCode.Conflict, "resource.conflict");
    }
}
