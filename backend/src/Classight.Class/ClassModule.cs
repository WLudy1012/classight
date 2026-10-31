using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Class;

public record ProfileWrite(string Name, string? NameEn, string Motto, string Intro, DateOnly FoundedOn, string? CoverUrl, long? Version);
public record MemberWrite(string DisplayName, string? AvatarUrl, string? Title, string? Role, DateOnly? JoinedOn, string? Intro, long? Version);
public record TimelineWrite(string Title, string Summary, DateOnly OccurredOn, string? CoverUrl, string[] Tags, string Body, Guid[] Media, long? Version);
public record LinkWrite(Guid? UserId, long? Version);
public record MemberPublic(Guid Id, string DisplayName, string? AvatarUrl, string? Title, DateOnly? JoinedOn, string? Intro);
public record TimelinePublic(Guid Id, string Title, string Summary, DateOnly OccurredOn, string? CoverUrl, string[] Tags);
public sealed class ClassQueries(AppDbContext db) : IClassProfileQueries
{
    public async Task<LinkedMember?> GetLinkedMember(Guid userId, CancellationToken ct) => await db.Members.AsNoTracking().Where(x => x.UserId == userId && !x.Deleted).Select(x => new LinkedMember(x.Id, x.DisplayName, x.AvatarUrl, x.Title)).SingleOrDefaultAsync(ct);
}
public sealed class ClassModule : IModule
{
    public string Name => "Class";
    public IEnumerable<PermissionDefinition> DeclarePermissions() => new[] { "class.profile.write", "class.members.manage", "class.timeline.manage" }.Select(x => new PermissionDefinition(x, Name, x));
    public void AddServices(IServiceCollection services, IConfiguration configuration) => services.AddScoped<IClassProfileQueries, ClassQueries>();
    private static MemberPublic Public(Member x) => new(x.Id, x.DisplayName, x.AvatarUrl, x.Title, x.JoinedOn, x.Intro);
    private static object Admin(Member x) => new { x.Id, x.DisplayName, x.AvatarUrl, x.Title, x.JoinedOn, x.Intro, linkedUserId = x.UserId, x.Version };
    private static TimelinePublic Public(TimelineEvent x) => new(x.Id, x.Title, x.Summary, x.OccurredOn, x.CoverUrl, x.Tags);
    private static readonly Dictionary<string, string> MemberSort = new() { ["name"] = "DisplayName", ["displayName"] = "DisplayName", ["createdAt"] = "CreatedAt", ["joinedOn"] = "JoinedOn" };
    private static readonly Dictionary<string, string> TimelineSort = new() { ["occurredOn"] = "OccurredOn", ["createdAt"] = "CreatedAt", ["title"] = "Title" };
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/class").WithTags("Class");
        group.AddEndpointFilter(async (context, next) =>
        {
            var settings = context.HttpContext.RequestServices.GetRequiredService<ISiteSettingsReader>();
            if (!(await settings.Get<SecuritySettings>("security", context.HttpContext.RequestAborted)).ClassInfoPublic && context.HttpContext.User.Identity?.IsAuthenticated != true) throw new ApiException(401, "auth.token_invalid", "请先登录");
            return await next(context);
        });
        group.MapGet("/profile", async (AppDbContext db, CancellationToken ct) => await db.ClassProfiles.AsNoTracking().SingleAsync(ct));
        group.MapGet("/overview", async (AppDbContext db, IClock clock, CancellationToken ct) =>
        {
            var profile = await db.ClassProfiles.AsNoTracking().SingleAsync(ct);
            var today = DateOnly.FromDateTime(clock.UtcNow.UtcDateTime);
            var years = today.Year - profile.FoundedOn.Year;
            if (profile.FoundedOn.AddYears(years) > today) years--;
            return new { profile, stats = new { memberCount = await db.Members.CountAsync(x => !x.Deleted, ct), timelineCount = await db.Timeline.CountAsync(x => !x.Deleted, ct), foundedYears = Math.Max(0, years) }, membersPreview = (await db.Members.AsNoTracking().Where(x => !x.Deleted).OrderBy(x => x.DisplayName).Take(12).ToListAsync(ct)).Select(Public), latestTimeline = (await db.Timeline.AsNoTracking().Where(x => !x.Deleted).OrderByDescending(x => x.OccurredOn).ThenBy(x => x.Id).Take(5).ToListAsync(ct)).Select(Public) };
        });
        group.MapGet("/members", async (AppDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var query = FilterMembers(db.Members.AsNoTracking().Where(x => !x.Deleted), http.Request);
            var (page, size) = Input.Paging(http.Request); var total = await query.CountAsync(ct);
            var items = await QuerySort.Apply(query, http.Request, "name", MemberSort).Skip((page - 1) * size).Take(size).ToListAsync(ct);
            return new Page<MemberPublic>(items.Select(Public).ToArray(), total, page, size);
        });
        group.MapGet("/members/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) => Public(await db.Members.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound()));
        group.MapGet("/timeline", async (AppDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var query = db.Timeline.AsNoTracking().Where(x => !x.Deleted);
            if (http.Request.Query.TryGetValue("year", out var text))
            {
                if (!int.TryParse(text, out var year) || year is < 1 or > 9998) throw ApiException.Validation("year", "年份无效");
                var start = new DateOnly(year, 1, 1); var end = start.AddYears(1); query = query.Where(x => x.OccurredOn >= start && x.OccurredOn < end);
            }
            var (page, size) = Input.Paging(http.Request); var total = await query.CountAsync(ct);
            var items = await QuerySort.Apply(query, http.Request, "-occurredOn", TimelineSort).Skip((page - 1) * size).Take(size).ToListAsync(ct);
            return new Page<TimelinePublic>(items.Select(Public).ToArray(), total, page, size);
        });
        group.MapGet("/timeline/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var item = await db.Timeline.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            return new { item.Id, item.Title, item.Summary, item.OccurredOn, item.CoverUrl, item.Tags, item.Body, media = item.Media.Select(id => new { id, url = $"/api/v1/media/{id}" }), item.Version };
        });
        var admin = endpoints.MapGroup("/api/v1/admin/class").WithTags("Admin Class").RequireAuthorization();
        admin.MapPut("/profile", async (ProfileWrite body, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.ClassProfiles.SingleAsync(ct); Input.Version(http, body.Version, item.Version); var before = JsonDefaults.Serialize(item);
            if (!string.IsNullOrWhiteSpace(body.Name)) item.Name = Input.Required(body.Name, "name", 100); if (body.NameEn is not null) item.NameEn = Input.Optional(body.NameEn, "nameEn", 100); item.Motto = Input.Required(body.Motto, "motto", 500); item.Intro = Input.Optional(body.Intro, "intro", 100000) ?? ""; item.FoundedOn = body.FoundedOn; item.CoverUrl = Input.Url(body.CoverUrl, "coverUrl");
            await db.SaveChangesAsync(ct); await events.Publish(new("class.profile_updated", "ClassProfile", item.Id.ToString(), before, item, new ClassProfileUpdated(item.Id)), ct); return item;
        }).RequireAuthorization("class.profile.write");
        admin.MapGet("/members", async (AppDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var query = FilterMembers(db.Members.AsNoTracking().Where(x => !x.Deleted), http.Request); var (page, size) = Input.Paging(http.Request);
            var total = await query.CountAsync(ct); var items = await QuerySort.Apply(query, http.Request, "name", MemberSort).Skip((page - 1) * size).Take(size).ToListAsync(ct); return new Page<object>(items.Select(Admin).ToArray(), total, page, size);
        }).RequireAuthorization("class.members.manage");
        admin.MapPost("/members", async (MemberWrite body, AppDbContext db, IEventBus events, CancellationToken ct) =>
        {
            var item = new Member(); Apply(item, body); db.Members.Add(item); await db.SaveChangesAsync(ct); await events.Publish(new("member.created", "Member", item.Id.ToString(), null, item), ct); return Results.Created($"/api/v1/class/members/{item.Id}", Admin(item));
        }).RequireAuthorization("class.members.manage");
        admin.MapPut("/members/{id:guid}", async (Guid id, MemberWrite body, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.Members.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound(); if (body.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body.Version, item.Version); var before = JsonDefaults.Serialize(item);
            Apply(item, body); await db.SaveChangesAsync(ct); await events.Publish(new("member.updated", "Member", id.ToString(), before, item), ct); return Admin(item);
        }).RequireAuthorization("class.members.manage");
        admin.MapDelete("/members/{id:guid}", async (Guid id, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.Members.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound(); if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, item.Version); var before = JsonDefaults.Serialize(item);
            item.Deleted = true; item.UserId = null; await db.SaveChangesAsync(ct); await events.Publish(new("member.deleted", "Member", id.ToString(), before, null), ct); return Results.NoContent();
        }).RequireAuthorization("class.members.manage");
        foreach (var action in new[] { "link-user", "unlink-user" })
        {
            admin.MapPost("/members/{id:guid}/" + action, async (Guid id, LinkWrite body, AppDbContext db, IIdentityQueries identity, IEventBus events, HttpContext http, CancellationToken ct) =>
            {
                var item = await db.Members.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound(); if (body.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body.Version, item.Version);
                var userId = action == "link-user" ? body.UserId ?? throw ApiException.Validation("userId", "必须指定用户") : (Guid?)null;
                if (userId is { } target && await identity.GetUser(target, ct) is null) throw ApiException.NotFound();
                if (userId is not null && await db.Members.AnyAsync(x => x.Id != id && x.UserId == userId, ct)) throw ApiException.Conflict("账号已绑定其他成员档案");
                var before = new { item.UserId }; item.UserId = userId; await db.SaveChangesAsync(ct); await events.Publish(new("member." + action, "Member", id.ToString(), before, new { item.UserId }, new MemberLinked(id, userId)), ct); return Admin(item);
            }).RequireAuthorization("class.members.manage");
        }
        admin.MapPost("/timeline", async (TimelineWrite body, AppDbContext db, IEventBus events, CancellationToken ct) =>
        {
            var item = new TimelineEvent(); await Apply(item, body, db, ct); db.Timeline.Add(item); await db.SaveChangesAsync(ct); await events.Publish(new("timeline.created", "TimelineEvent", item.Id.ToString(), null, item), ct); return Results.Created($"/api/v1/class/timeline/{item.Id}", item);
        }).RequireAuthorization("class.timeline.manage");
        admin.MapPut("/timeline/{id:guid}", async (Guid id, TimelineWrite body, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.Timeline.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound(); if (body.Version is not null || http.Request.Headers.IfMatch.Count > 0) Input.Version(http, body.Version, item.Version); var before = JsonDefaults.Serialize(item);
            await Apply(item, body, db, ct); await db.SaveChangesAsync(ct); await events.Publish(new("timeline.updated", "TimelineEvent", id.ToString(), before, item), ct); return item;
        }).RequireAuthorization("class.timeline.manage");
        admin.MapDelete("/timeline/{id:guid}", async (Guid id, AppDbContext db, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.Timeline.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound(); if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, item.Version); item.Deleted = true; await db.SaveChangesAsync(ct); await events.Publish(new("timeline.deleted", "TimelineEvent", id.ToString(), item, null), ct); return Results.NoContent();
        }).RequireAuthorization("class.timeline.manage");
    }
    private static IQueryable<Member> FilterMembers(IQueryable<Member> query, HttpRequest request)
    {
        if (request.Query.TryGetValue("q", out var q)) { var value = q.ToString(); query = query.Where(x => x.DisplayName.Contains(value)); }
        if (request.Query.TryGetValue("role", out var role)) { var value = role.ToString(); query = query.Where(x => x.Role == value); }
        return query;
    }
    private static void Apply(Member item, MemberWrite body)
    {
        item.DisplayName = Input.Required(body.DisplayName, "displayName", 100); item.AvatarUrl = Input.Url(body.AvatarUrl, "avatarUrl"); item.Title = Input.Optional(body.Title, "title", 100); item.Role = Input.Required(body.Role ?? "student", "role", 64); item.JoinedOn = body.JoinedOn; item.Intro = Input.Optional(body.Intro, "intro");
    }
    private static async Task Apply(TimelineEvent item, TimelineWrite body, AppDbContext db, CancellationToken ct)
    {
        item.Title = Input.Required(body.Title, "title", 200); item.Summary = Input.Optional(body.Summary, "summary") ?? ""; item.Body = Input.Optional(body.Body, "body", 100000) ?? ""; item.OccurredOn = body.OccurredOn; item.CoverUrl = Input.Url(body.CoverUrl, "coverUrl");
        if (body.Tags?.Length > 20 || body.Media?.Length > 100) throw ApiException.Validation("tags", "标签最多 20 个，媒体最多 100 个");
        item.Tags = body.Tags?.Select(x => Input.Required(x, "tags", 50)).Distinct().ToArray() ?? []; item.Media = body.Media?.Distinct().ToArray() ?? [];
        if (await db.Media.CountAsync(x => item.Media.Contains(x.Id) && !x.Deleted && x.Public, ct) != item.Media.Length) throw ApiException.Validation("media", "仅可关联存在的公开媒体");
    }
}
