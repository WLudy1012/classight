using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Classight.Api;
using Classight.Platform;
using Classight.SharedKernel;
using Classight.Speech;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class SpeechTests
{
    private const string AdminPassword = "IntegrationAdmin123!";

    private sealed class FakeClock(DateTimeOffset start) : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = start;
    }

    private static async Task<HttpClient> AdminOf(ApiFactory app) => app.As(await Kit.Login(app.Client(), "admin", AdminPassword));

    private static HttpClient Anonymous(WebApplicationFactory<Program> app) => app.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false, AllowAutoRedirect = false });

    private static HttpClient Bearer(WebApplicationFactory<Program> app, string token)
    {
        var client = Anonymous(app); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token); return client;
    }

    private static async Task<Guid> CreateSession(HttpClient admin, object body) =>
        (await Kit.Json(await admin.PostAsJsonAsync("/api/v1/admin/speech/sessions", body))).GetProperty("id").GetGuid();

    private static async Task<JsonElement> Detail(HttpClient client, Guid sessionId) =>
        await Kit.Json(await client.GetAsync($"/api/v1/speech/sessions/{sessionId}"));

    private static async Task<JsonElement> SignUp(HttpClient member, Guid sessionId, string topic, Guid? teamId = null) =>
        await Kit.Json(await member.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/entries", new { topic, teamId }));

    private static async Task<Guid> AdminEntry(HttpClient admin, Guid sessionId, Guid ownerId, string topic) =>
        (await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/entries", new { topic, ownerId }))).GetProperty("id").GetGuid();

    private static async Task<JsonElement> Upload(HttpClient client, Guid entryId, byte[] bytes, string fileName) =>
        await Kit.Json(await client.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(bytes, fileName)));

    private static async Task<JsonElement> Ticket(HttpClient client, Guid coursewareId) =>
        await Kit.Json(await client.PostAsync($"/api/v1/speech/courseware/{coursewareId}/preview-ticket", null));

    /// <summary>Opens a session with one signed-up member who owns the returned entry.</summary>
    private static async Task<(HttpClient Owner, Guid EntryId, Guid SessionId)> OwnedEntry(ApiFactory app, HttpClient admin, string name = "owner")
    {
        var sessionId = await Kit.OpenSession(admin);
        var member = await Kit.Member(app, admin, name);
        var entry = await SignUp(member.Client, sessionId, "我的课题");
        return (member.Client, entry.GetProperty("id").GetGuid(), sessionId);
    }

    private static string TokenOf(string previewUrl) => previewUrl.Split('/')[5];

    private static async Task AssertNoTraversalWrite(HttpResponseMessage response, ApiFactory app)
    {
        if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
            await Kit.Problem(response, HttpStatusCode.UnprocessableEntity, "courseware.invalid_archive");
        else
        {
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            await Kit.Json(response);
        }
        Assert.Empty(Directory.GetFiles(app.Root, "evil.html", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(app.Root, "abs.html", SearchOption.AllDirectories));
    }

    private static async Task<Dictionary<string, string[]>> RolePermissions(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Roles.AsNoTracking().Where(x => x.Name == "Member" || x.Name == "Admin" || x.Name == "SuperAdmin").ToDictionaryAsync(x => x.Name, x => x.Permissions);
    }

    [Fact]
    public async Task Signup_is_one_entry_per_session_and_admin_routes_are_closed()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await Kit.OpenSession(admin);
        var member = await Kit.Member(app, admin, "student1");
        var created = await SignUp(member.Client, sessionId, "我的论文");
        Assert.Equal("我的论文", created.GetProperty("topic").GetString());
        Assert.Equal("queued", created.GetProperty("status").GetString());
        Assert.True(created.GetProperty("mine").GetBoolean());

        await Kit.Problem(await member.Client.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/entries", new { topic = "再报一次" }), HttpStatusCode.Conflict, "speech.already_signed_up");

        var draftId = await CreateSession(admin, new { title = "草稿场次", date = "2026-12-01" });
        var draftSignup = await member.Client.PostAsJsonAsync($"/api/v1/speech/sessions/{draftId}/entries", new { topic = "偷跑" });
        Assert.False(draftSignup.IsSuccessStatusCode);
        Assert.True(draftSignup.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden);

        await Kit.Problem(await member.Client.GetAsync("/api/v1/admin/speech/sessions"), HttpStatusCode.Forbidden, "permission.denied");
        await Kit.Problem(await member.Client.PostAsJsonAsync("/api/v1/admin/speech/sessions", new { title = "越权", date = "2026-12-02" }), HttpStatusCode.Forbidden, "permission.denied");

        using var anonymous = app.Client();
        await Kit.Problem(await anonymous.GetAsync("/api/v1/admin/speech/sessions"), HttpStatusCode.Unauthorized, "auth.token_invalid");
        await Kit.Problem(await anonymous.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/entries", new { topic = "匿名" }), HttpStatusCode.Unauthorized, "auth.token_invalid");
    }

    [Fact]
    public async Task Team_capacity_and_join_code_visibility()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await CreateSession(admin, new { title = "组队班会", date = "2026-11-03", slotMinutes = 5, allowTeams = true, maxTeamSize = 2 });
        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "open" }));
        var leader = await Kit.Member(app, admin, "leader");
        var second = await Kit.Member(app, admin, "second");
        var third = await Kit.Member(app, admin, "third");
        var outsider = await Kit.Member(app, admin, "outsider");

        var team = await Kit.Json(await leader.Client.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/teams", new { name = "甲队" }));
        var teamId = team.GetProperty("id").GetGuid();
        var code = team.GetProperty("joinCode").GetString()!;
        Assert.True(team.GetProperty("mine").GetBoolean());

        var joined = await Kit.Json(await second.Client.PostAsJsonAsync("/api/v1/speech/teams/join", new { code }));
        Assert.Equal(teamId, joined.GetProperty("id").GetGuid());

        await Kit.Problem(await third.Client.PostAsJsonAsync("/api/v1/speech/teams/join", new { code }), HttpStatusCode.Conflict, "speech.team_full");

        var seen = (await Detail(outsider.Client, sessionId)).GetProperty("teams").EnumerateArray().Single();
        Assert.False(seen.TryGetProperty("joinCode", out _));
        Assert.Equal(2, seen.GetProperty("members").GetArrayLength());
        Assert.False(seen.GetProperty("mine").GetBoolean());

        var leaderView = (await Detail(leader.Client, sessionId)).GetProperty("teams").EnumerateArray().Single();
        Assert.Equal(code, leaderView.GetProperty("joinCode").GetString());
    }

    [Fact]
    public async Task Teams_are_refused_when_the_session_disallows_them()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await CreateSession(admin, new { title = "个人场", date = "2026-11-03", slotMinutes = 5, allowTeams = false, maxTeamSize = 3 });
        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "open" }));
        var student = await Kit.Member(app, admin, "solo");
        await Kit.Problem(await student.Client.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/teams", new { name = "不允许" }), HttpStatusCode.Forbidden, "speech.teams_disabled");
    }

    [Fact]
    public async Task Leader_cannot_leave_and_disbanding_removes_the_team_entry()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await CreateSession(admin, new { title = "解散测试", date = "2026-11-03", slotMinutes = 5, allowTeams = true, maxTeamSize = 3 });
        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "open" }));
        var leader = await Kit.Member(app, admin, "captain");
        var second = await Kit.Member(app, admin, "crew");

        var team = await Kit.Json(await leader.Client.PostAsJsonAsync($"/api/v1/speech/sessions/{sessionId}/teams", new { name = "乙队" }));
        var teamId = team.GetProperty("id").GetGuid();
        var code = team.GetProperty("joinCode").GetString()!;
        await Kit.Json(await second.Client.PostAsJsonAsync("/api/v1/speech/teams/join", new { code }));
        var teamEntry = await SignUp(leader.Client, sessionId, "团队发言", teamId);
        var entryId = teamEntry.GetProperty("id").GetGuid();
        Assert.Equal(teamId, teamEntry.GetProperty("team").GetProperty("id").GetGuid());

        await Kit.Problem(await leader.Client.DeleteAsync($"/api/v1/speech/teams/{teamId}/members/{leader.Id}"), HttpStatusCode.Conflict, "resource.conflict");

        Assert.Equal(HttpStatusCode.NoContent, (await leader.Client.DeleteAsync($"/api/v1/speech/teams/{teamId}")).StatusCode);

        var detail = await Detail(admin, sessionId);
        Assert.DoesNotContain(detail.GetProperty("entries").EnumerateArray(), e => e.GetProperty("id").GetGuid() == entryId);
        Assert.DoesNotContain(detail.GetProperty("teams").EnumerateArray(), t => t.GetProperty("id").GetGuid() == teamId);
    }

    [Fact]
    public async Task Status_flow_speaking_exclusivity_and_invalid_transitions()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await Kit.OpenSession(admin);
        var ids = new List<Guid>();
        for (var i = 1; i <= 3; i++)
        {
            var speaker = await Kit.Member(app, admin, "speaker" + i);
            ids.Add(await AdminEntry(admin, sessionId, speaker.Id, "议题" + i));
        }

        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "running" }));

        var first = await Kit.Json(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[0]}/start", null));
        Assert.Equal("speaking", first.GetProperty("status").GetString());
        Assert.Equal(ids[0], (await Detail(admin, sessionId)).GetProperty("currentEntryId").GetGuid());

        await Kit.Problem(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[1]}/start", null), HttpStatusCode.Conflict, "speech.speaking_exists");

        var finished = await Kit.Json(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[0]}/finish", null));
        Assert.Equal("done", finished.GetProperty("status").GetString());

        var second = await Kit.Json(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[1]}/start", null));
        Assert.Equal("speaking", second.GetProperty("status").GetString());
        await Kit.Json(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[1]}/finish", null));

        var skipped = await Kit.Json(await admin.PostAsync($"/api/v1/admin/speech/entries/{ids[2]}/skip", null));
        Assert.Equal("skipped", skipped.GetProperty("status").GetString());

        var draftId = await CreateSession(admin, new { title = "草稿", date = "2026-12-05" });
        await Kit.Problem(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{draftId}/status", new { status = "closed" }), HttpStatusCode.Conflict, "resource.conflict");
    }

    [Fact]
    public async Task Order_endpoint_reorders_the_queue_and_rejects_a_wrong_set()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var sessionId = await Kit.OpenSession(admin);
        var ids = new List<Guid>();
        for (var i = 1; i <= 3; i++)
        {
            var speaker = await Kit.Member(app, admin, "queue" + i);
            ids.Add(await AdminEntry(admin, sessionId, speaker.Id, "顺序" + i));
        }

        var reordered = new[] { ids[2], ids[0], ids[1] };
        await Kit.Json(await admin.PutAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/order", new { entryIds = reordered }));
        var order = (await Detail(admin, sessionId)).GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToArray();
        Assert.Equal(reordered, order);

        var wrongSet = await admin.PutAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/order", new { entryIds = new[] { ids[0], ids[1] } });
        Assert.False(wrongSet.IsSuccessStatusCode);
        await Kit.Problem(wrongSet, HttpStatusCode.BadRequest, "validation.failed");
    }

    [Fact]
    public async Task Courseware_pptx_is_replaced_by_pdf_and_the_old_files_are_removed()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, sessionId) = await OwnedEntry(app, admin);
        var store = app.Services.GetRequiredService<CoursewareStore>();

        var pptx = await Upload(owner, entryId, Kit.Pptx(), "deck.pptx");
        Assert.Equal("pptx", pptx.GetProperty("kind").GetString());
        var firstId = pptx.GetProperty("id").GetGuid();
        Assert.True(Directory.Exists(store.Dir(firstId)));

        var pdf = await Upload(owner, entryId, Kit.Pdf(), "lecture.pdf");
        Assert.Equal("pdf", pdf.GetProperty("kind").GetString());
        Assert.Equal("pdf", pdf.GetProperty("previewMode").GetString());
        var secondId = pdf.GetProperty("id").GetGuid();

        var courseware = (await Detail(owner, sessionId)).GetProperty("entries").EnumerateArray().Single().GetProperty("courseware");
        Assert.Equal(secondId, courseware.GetProperty("id").GetGuid());
        Assert.Equal("lecture.pdf", courseware.GetProperty("originalName").GetString());

        Assert.False(Directory.Exists(store.Dir(firstId)));
        Assert.True(Directory.Exists(store.Dir(secondId)));
        await Kit.Problem(await owner.GetAsync($"/api/v1/speech/courseware/{firstId}"), HttpStatusCode.NotFound, "resource.not_found");
    }

    [Fact]
    public async Task Courseware_type_detection_and_rejections()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);

        var ppt = await Upload(owner, entryId, Kit.Ppt(), "legacy.ppt");
        Assert.Equal("ppt", ppt.GetProperty("kind").GetString());
        Assert.Equal("none", ppt.GetProperty("previewMode").GetString());

        var site = await Upload(owner, entryId, Kit.Site(), "site.zip");
        Assert.Equal("web", site.GetProperty("kind").GetString());
        Assert.Equal("web", site.GetProperty("previewMode").GetString());

        await Kit.Problem(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(Kit.Zip(("readme.txt", "no index here")), "bad.zip")), HttpStatusCode.UnprocessableEntity, "courseware.invalid_archive");
        await Kit.Problem(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(Encoding.UTF8.GetBytes("just text"), "notes.txt")), HttpStatusCode.UnprocessableEntity, "courseware.unsupported_type");
    }

    [Fact]
    public async Task Courseware_is_owner_only_and_blocked_once_the_session_is_closed()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, sessionId) = await OwnedEntry(app, admin);
        var stranger = await Kit.Member(app, admin, "stranger");

        await Kit.Problem(await stranger.Client.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(Kit.Pdf(), "mine.pdf")), HttpStatusCode.Forbidden, "permission.denied");

        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "running" }));
        await Kit.Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{sessionId}/status", new { status = "closed" }));

        await Kit.Problem(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(Kit.Pdf(), "late.pdf")), HttpStatusCode.Forbidden, "speech.closed");
    }

    [Fact]
    public async Task Courseware_larger_than_the_configured_limit_is_rejected()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);

        var settings = await Kit.Json(await admin.GetAsync("/api/v1/admin/settings/speech"));
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/settings/speech", new { values = new { maxCoursewareMb = 1 }, version = settings.GetProperty("version").GetInt64() }));

        var big = Kit.Pdf().Concat(new byte[1_500_000]).ToArray();
        await Kit.Problem(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(big, "big.pdf")), HttpStatusCode.RequestEntityTooLarge, "courseware.too_large");
    }

    [Fact]
    public async Task Zip_entries_that_escape_the_site_folder_are_rejected_or_dropped()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);

        var relative = Kit.Zip(("../evil.html", "<p>evil</p>"), ("index.html", "<html><body>ok</body></html>"));
        await AssertNoTraversalWrite(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(relative, "trap.zip")), app);

        var absolute = Kit.Zip(("/abs.html", "<p>abs</p>"), ("index.html", "<html><body>ok</body></html>"));
        await AssertNoTraversalWrite(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(absolute, "abs.zip")), app);
    }

    [Fact]
    public async Task Zip_with_more_than_2000_entries_is_rejected()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);

        var entries = Enumerable.Range(0, 2001).Select(i => ($"f{i}.txt", "x")).Append(("index.html", "<html></html>")).ToArray();
        await Kit.Problem(await owner.PostAsync($"/api/v1/speech/entries/{entryId}/courseware", Kit.Upload(Kit.Zip(entries), "many.zip")), HttpStatusCode.UnprocessableEntity, "courseware.invalid_archive");
    }

    [Fact]
    public async Task Pdf_preview_is_anonymous_signed_and_supports_range_requests()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);
        var uploaded = await Upload(owner, entryId, Kit.Pdf(), "lecture.pdf");

        var ticket = await Ticket(owner, uploaded.GetProperty("id").GetGuid());
        Assert.Equal("pdf", ticket.GetProperty("mode").GetString());
        Assert.Equal("lecture.pdf", ticket.GetProperty("fileName").GetString());
        var url = ticket.GetProperty("url").GetString()!;

        using var anonymous = app.Client();
        var file = await anonymous.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Equal("application/pdf", file.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Kit.Pdf(), await file.Content.ReadAsByteArrayAsync());

        var range = new HttpRequestMessage(HttpMethod.Get, url);
        range.Headers.Range = new RangeHeaderValue(0, 4);
        var partial = await anonymous.SendAsync(range);
        Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
        Assert.Equal(5, (await partial.Content.ReadAsByteArrayAsync()).Length);
    }

    [Fact]
    public async Task Web_preview_is_sandboxed_and_serves_sibling_assets()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);
        var uploaded = await Upload(owner, entryId, Kit.Site(), "site.zip");

        var ticket = await Ticket(owner, uploaded.GetProperty("id").GetGuid());
        Assert.Equal("web", ticket.GetProperty("mode").GetString());
        var url = ticket.GetProperty("url").GetString()!;
        Assert.EndsWith("/site/index.html", url, StringComparison.Ordinal);

        using var anonymous = app.Client();
        var page = await anonymous.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Equal("text/html", page.Content.Headers.ContentType?.MediaType);
        Assert.Equal("sandbox allow-scripts", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", page.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("*", page.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var siteBase = url[..url.LastIndexOf('/')];
        var script = await anonymous.GetAsync(siteBase + "/app.js");
        Assert.Equal(HttpStatusCode.OK, script.StatusCode);
        Assert.Equal("text/javascript", script.Content.Headers.ContentType?.MediaType);
        Assert.Equal("console.log(1)", await script.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Preview_paths_cannot_escape_the_site_folder()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);
        var uploaded = await Upload(owner, entryId, Kit.Site(), "site.zip");
        var url = (await Ticket(owner, uploaded.GetProperty("id").GetGuid())).GetProperty("url").GetString()!;
        var siteBase = url[..url.LastIndexOf('/')];

        using var anonymous = app.Client();
        foreach (var suffix in new[] { "/..%2f..%2fappsettings.json", "/%2e%2e/%2e%2e/x" })
        {
            var response = await anonymous.GetAsync(siteBase + suffix);
            Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task Preview_tokens_must_be_intact_and_die_with_their_courseware()
    {
        await using var app = new ApiFactory();
        var admin = await AdminOf(app);
        var (owner, entryId, _) = await OwnedEntry(app, admin);
        var uploaded = await Upload(owner, entryId, Kit.Pdf(), "lecture.pdf");
        var coursewareId = uploaded.GetProperty("id").GetGuid();
        var url = (await Ticket(owner, coursewareId)).GetProperty("url").GetString()!;
        var token = TokenOf(url);

        using var anonymous = app.Client();
        var chars = token.ToCharArray();
        var index = chars.Length - 10; // inside the signature half
        chars[index] = chars[index] == 'A' ? 'B' : 'A';
        var tampered = url.Replace(token, new string(chars), StringComparison.Ordinal);
        await Kit.Problem(await anonymous.GetAsync(tampered), HttpStatusCode.Unauthorized, "preview.token_invalid");

        await Kit.Problem(await anonymous.GetAsync("/api/v1/speech/preview/notatoken/file"), HttpStatusCode.Unauthorized, "preview.token_invalid");
        await Kit.Problem(await anonymous.GetAsync("/api/v1/speech/preview/a.b.c/file"), HttpStatusCode.Unauthorized, "preview.token_invalid");

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/v1/speech/courseware/{coursewareId}")).StatusCode);
        await Kit.Problem(await anonymous.GetAsync(url), HttpStatusCode.NotFound, "resource.not_found");
    }

    [Fact]
    public async Task Preview_tokens_expire_after_ten_minutes()
    {
        var clock = new FakeClock(DateTimeOffset.UtcNow);
        await using var basis = new ApiFactory();
        await using var app = basis.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IClock>();
            services.AddSingleton<IClock>(clock);
        }));

        var admin = Bearer(app, await Kit.Login(Anonymous(app), "admin", AdminPassword));
        await Kit.Json(await admin.PostAsJsonAsync("/api/v1/admin/users", new { username = "expiry", displayName = "expiry", password = "MemberPass12345!", roles = new[] { "Member" } }));
        var owner = Bearer(app, await Kit.Login(Anonymous(app), "expiry", "MemberPass12345!"));
        var sessionId = await Kit.OpenSession(admin);
        var entry = await SignUp(owner, sessionId, "过期测试");
        var uploaded = await Upload(owner, entry.GetProperty("id").GetGuid(), Kit.Pdf(), "lecture.pdf");
        var url = (await Ticket(owner, uploaded.GetProperty("id").GetGuid())).GetProperty("url").GetString()!;

        using var anonymous = Anonymous(app);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync(url)).StatusCode);

        clock.UtcNow = clock.UtcNow.AddMinutes(11);
        await Kit.Problem(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized, "preview.token_invalid");
    }

    [Fact]
    public async Task Missing_speech_permissions_are_backfilled_once_and_admin_removals_stick()
    {
        await using var app = new ApiFactory();
        var services = app.Services;
        var nonSpeech = services.GetRequiredService<IPermissionCatalog>().All.Select(x => x.Code).Where(x => !x.StartsWith("speech.", StringComparison.Ordinal)).ToArray();

        await using (var scope = services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var role in await db.Roles.Where(x => x.Name == "Member" || x.Name == "Admin" || x.Name == "SuperAdmin").ToListAsync())
                role.Permissions = role.Permissions.Where(x => !x.StartsWith("speech.", StringComparison.Ordinal)).ToArray();
            await SystemState.Update(db, doc => doc.SeededPermissions = nonSpeech, CancellationToken.None);
        }

        await DatabaseBootstrap.Initialize(services, services.GetRequiredService<IConfiguration>(), services.GetRequiredService<IHostEnvironment>(), CancellationToken.None);
        var roles = await RolePermissions(services);
        Assert.Contains("speech.participate", roles["Member"]);
        Assert.Contains("speech.participate", roles["Admin"]);
        Assert.Contains("speech.manage", roles["Admin"]);
        Assert.Contains("speech.participate", roles["SuperAdmin"]);
        Assert.Contains("speech.manage", roles["SuperAdmin"]);

        await using (var scope = services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var member = await db.Roles.SingleAsync(x => x.Name == "Member");
            member.Permissions = member.Permissions.Where(x => x != "speech.participate").ToArray();
            await db.SaveChangesAsync();
        }

        await DatabaseBootstrap.Initialize(services, services.GetRequiredService<IConfiguration>(), services.GetRequiredService<IHostEnvironment>(), CancellationToken.None);
        Assert.DoesNotContain("speech.participate", (await RolePermissions(services))["Member"]);
    }
}
