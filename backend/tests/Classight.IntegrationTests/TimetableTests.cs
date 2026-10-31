using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class TimetableTests
{
    [Fact]
    public async Task Timetable_respects_permissions_versions_conflicts_and_plugin_state()
    {
        await using var app = new ApiFactory();
        var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        var member = (await Kit.Member(app, admin, "timetable_member")).Client;
        var initial = await Kit.Json(await member.GetAsync("/api/v1/timetable"));
        Assert.Equal(0, initial.GetProperty("version").GetInt64());
        var a = new { id = Guid.NewGuid(), name = "Math", teacher = "Teacher", room = "A", day = 1, startPeriod = 1, endPeriod = 2, startWeek = 1, endWeek = 10, weeks = "odd" };
        var b = new { id = Guid.NewGuid(), name = "Science", teacher = "Teacher", room = "B", day = 1, startPeriod = 1, endPeriod = 2, startWeek = 1, endWeek = 10, weeks = "even" };
        object Input(long version, object[] lessons) => new { term = "Term", startDate = "2026-09-07", totalWeeks = 20, periods = new[] { new { start = "08:00", end = "08:45" }, new { start = "08:55", end = "09:40" } }, lessons, version };
        await Kit.Problem(await member.PutAsJsonAsync("/api/v1/timetable", Input(0, [a])), HttpStatusCode.Forbidden, "permission.denied");
        var saved = await Kit.Json(await admin.PutAsJsonAsync("/api/v1/timetable", Input(0, [a, b])));
        Assert.Equal(1, saved.GetProperty("version").GetInt64());
        Assert.Equal(2, (await Kit.Json(await member.GetAsync("/api/v1/timetable"))).GetProperty("lessons").GetArrayLength());
        await Kit.Problem(await admin.PutAsJsonAsync("/api/v1/timetable", Input(0, [a])), HttpStatusCode.Conflict, "resource.version_mismatch");
        var overlap = new { id = Guid.NewGuid(), name = "Clash", teacher = "", room = "", day = 1, startPeriod = 2, endPeriod = 2, startWeek = 3, endWeek = 9, weeks = "all" };
        await Kit.Problem(await admin.PutAsJsonAsync("/api/v1/timetable", Input(1, [a, overlap])), HttpStatusCode.BadRequest, "validation.failed");
        var large = Enumerable.Range(0, 100).Select(i => (object)new { id = Guid.NewGuid(), name = new string('课', 100), teacher = new string('师', 100), room = new string('室', 100), day = i % 7 + 1, startPeriod = i / 7 % 2 + 1, endPeriod = i / 7 % 2 + 1, startWeek = i / 14 + 1, endWeek = i / 14 + 1, weeks = "all" }).ToArray();
        await Kit.Problem(await admin.PutAsJsonAsync("/api/v1/timetable", Input(1, large)), HttpStatusCode.BadRequest, "validation.failed");
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/timetable", new { enabled = false }));
        await Kit.Problem(await member.GetAsync("/api/v1/timetable"), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Problem(await admin.PutAsJsonAsync("/api/v1/timetable", Input(1, [a])), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/timetable", new { enabled = true }));
        Assert.Equal(2, (await Kit.Json(await member.GetAsync("/api/v1/timetable"))).GetProperty("lessons").GetArrayLength());
    }
}
