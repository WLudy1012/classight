using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Classight.Contracts;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class MemberPermissionTests
{
    [Fact]
    public async Task Extension_checks_the_current_session_and_fails_closed_when_disabled()
    {
        await using var app = new ApiFactory();
        using var anonymous = app.Client();
        using var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/member-identity/permissions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/v1/member-identity/permissions")).StatusCode);
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/member-identity", new { enabled = true }));
        var data = await Kit.Json(await admin.GetAsync("/api/v1/member-identity/permissions"));
        Assert.Contains(data.GetProperty("permissions").EnumerateArray(), p => p.GetString() == "site.settings.write");

        using var scope = app.Services.CreateScope();
        var accessor = scope.ServiceProvider.GetRequiredService<IHttpContextAccessor>();
        accessor.HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("permission", "speech.participate"),
            new Claim("permission", "unknown.permission")
        ], "test")) };
        var verifier = scope.ServiceProvider.GetRequiredService<IMemberPermissionVerifier>();
        Assert.True(await verifier.HasPermission("speech.participate", default));
        Assert.False(await verifier.HasPermission("speech.manage", default));
        Assert.False(await verifier.HasPermission("unknown.permission", default));
        await Assert.ThrowsAsync<ApiException>(() => verifier.RequirePermission("speech.manage", default));

        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/member-identity", new { enabled = false }));
        Assert.False(await verifier.HasPermission("speech.participate", default));
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/auth/me")).StatusCode);
    }
}
