using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Timetable;

public sealed record TimetablePeriod(string Start, string End);
public sealed record TimetableLesson(Guid Id, string Name, string Teacher, string Room, int Day, int StartPeriod, int EndPeriod, int StartWeek, int EndWeek, string Weeks);
public sealed record TimetableWrite(string Term, DateOnly StartDate, int TotalWeeks, TimetablePeriod[] Periods, TimetableLesson[] Lessons, long Version);

public sealed class TimetableModule : IPluginModule
{
    private const string Group = "plugin:timetable:data";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };
    public string Name => "Timetable";
    public PluginManifest Manifest => new("timetable", "Timetable", "Term, weeks and lessons", "1.0.0", WorkspacePath: "timetable", Icon: "calendar");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => [new("timetable.manage", Name, "管理课程表")];
    public void AddServices(IServiceCollection services, IConfiguration configuration) => services.AddSingleton<IManagedPlugin>(new ManagedPlugin("timetable", true));
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/timetable").RequireAuthorization().WithTags("Timetable");
        group.AddEndpointFilter(async (context, next) =>
        {
            var enabled = await context.HttpContext.RequestServices.GetRequiredService<PluginStateStore>().IsEnabled("timetable", context.HttpContext.RequestAborted);
            if (!enabled) throw ApiException.NotFound();
            return await next(context);
        });
        group.MapGet("", async (AppDbContext db, CancellationToken ct) =>
        {
            var item = await db.Settings.AsNoTracking().SingleOrDefaultAsync(x => x.Group == Group, ct);
            return item is null ? Default() : Parse(item);
        });
        group.MapPut("", async ([FromBody] TimetableWrite input, AppDbContext db, IEventBus events, CancellationToken ct) =>
        {
            Validate(input);
            var item = await db.Settings.SingleOrDefaultAsync(x => x.Group == Group, ct);
            if (input.Version != (item?.Version ?? 0)) throw new ApiException(409, "resource.version_mismatch", "课表已被修改，请重新加载");
            if (item is null) { item = new Setting { Group = Group }; db.Settings.Add(item); }
            var json = JsonSerializer.Serialize(input with { Version = 0 }, Json);
            if (Encoding.UTF8.GetByteCount(json) > 60_000) throw ApiException.Validation("lessons", "课程表数据过大，请减少课程或缩短名称");
            item.Json = json;
            await db.SaveChangesAsync(ct);
            await events.Publish(new("timetable.updated", "Timetable", Group, null, new { input.Term, lessons = input.Lessons.Length }), ct);
            return Parse(item);
        }).RequireAuthorization("timetable.manage");
    }

    private static TimetableWrite Parse(Setting item) => (JsonSerializer.Deserialize<TimetableWrite>(item.Json, Json) ?? Default()) with { Version = item.Version };
    private static TimetableWrite Default()
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        var monday = today.AddDays(-((int)today.DayOfWeek + 6) % 7);
        return new("", monday, 20, [new("08:00", "08:45"), new("08:55", "09:40"), new("10:00", "10:45"), new("10:55", "11:40"), new("14:00", "14:45"), new("14:55", "15:40"), new("16:00", "16:45"), new("16:55", "17:40")], [], 0);
    }
    private static bool Time(string value) => TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    private static bool InWeek(TimetableLesson c, int week) => week >= c.StartWeek && week <= c.EndWeek && (c.Weeks == "all" || (c.Weeks == "odd" ? week % 2 == 1 : week % 2 == 0));
    private static void Validate(TimetableWrite input)
    {
        if (input.Term is null || input.Term.Length > 100 || input.StartDate.DayOfWeek != DayOfWeek.Monday || input.TotalWeeks is < 1 or > 40)
            throw ApiException.Validation("term", "学期开始日期须为周一，周数为 1–40");
        if (input.Periods is null || input.Periods.Length is < 1 or > 20 || input.Lessons is null || input.Lessons.Length > 1000)
            throw ApiException.Validation("periods", "节次为 1–20，课程最多 1000 条");
        string previous = "";
        foreach (var p in input.Periods)
        {
            if (p is null || !Time(p.Start) || !Time(p.End) || string.CompareOrdinal(p.Start, p.End) >= 0 || string.CompareOrdinal(p.Start, previous) < 0)
                throw ApiException.Validation("periods", "节次时间须按顺序排列且不能重叠");
            previous = p.End;
        }
        var ids = new HashSet<Guid>();
        for (var i = 0; i < input.Lessons.Length; i++)
        {
            var c = input.Lessons[i];
            if (c is null || c.Id == Guid.Empty || !ids.Add(c.Id) || string.IsNullOrWhiteSpace(c.Name) || c.Name.Length > 100 || c.Teacher is null || c.Teacher.Length > 100 || c.Room is null || c.Room.Length > 100 || c.Day is < 1 or > 7 || c.StartPeriod < 1 || c.EndPeriod < c.StartPeriod || c.EndPeriod > input.Periods.Length || c.StartWeek < 1 || c.EndWeek < c.StartWeek || c.EndWeek > input.TotalWeeks || c.Weeks is not ("all" or "odd" or "even"))
                throw ApiException.Validation("lessons", "课程信息不完整或超出课表范围");
            foreach (var other in input.Lessons.Take(i))
                if (other.Day == c.Day && other.StartPeriod <= c.EndPeriod && c.StartPeriod <= other.EndPeriod && Enumerable.Range(Math.Max(c.StartWeek, other.StartWeek), Math.Max(0, Math.Min(c.EndWeek, other.EndWeek) - Math.Max(c.StartWeek, other.StartWeek) + 1)).Any(w => InWeek(c, w) && InWeek(other, w)))
                    throw ApiException.Validation("lessons", $"课程时间冲突：{other.Name} / {c.Name}");
        }
    }
}
