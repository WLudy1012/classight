using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class PluginMeetingTests
{
    [Fact]
    public async Task Disabling_meetings_blocks_member_admin_and_preview_endpoints_and_can_be_reversed()
    {
        await using var app = new ApiFactory();
        var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/speech/sessions")).StatusCode);
        Assert.True((await Kit.Json(await admin.GetAsync("/api/v1/plugins"))).GetProperty("meetings").GetBoolean());

        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/meetings", new { enabled = false }));
        Assert.False((await Kit.Json(await admin.GetAsync("/api/v1/plugins"))).GetProperty("meetings").GetBoolean());
        var managed = await Kit.Json(await admin.GetAsync("/api/v1/admin/plugins"));
        Assert.False(managed.EnumerateArray().Single(p => p.GetProperty("id").GetString() == "meetings").GetProperty("enabled").GetBoolean());
        await Kit.Problem(await admin.GetAsync("/api/v1/speech/sessions"), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Problem(await admin.GetAsync("/api/v1/admin/speech/sessions"), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Problem(await app.Client().GetAsync("/api/v1/speech/preview/example/file"), HttpStatusCode.NotFound, "resource.not_found");

        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/meetings", new { enabled = true }));
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/speech/sessions")).StatusCode);
    }
}
