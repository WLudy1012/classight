using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using MongoDB.Driver;
using StackExchange.Redis;

namespace Classight.SiteAdmin;

public interface ISettingsStore : ISiteSettingsReader
{
    Task<Setting> Find(string group, CancellationToken ct);
    Task<Setting> Update(string group, JsonElement body, HttpContext http, CancellationToken ct);
}
public record AuditView(Guid Id, DateTimeOffset At, string Actor, string Action, string ResourceType, string? ResourceId, string Summary, object[]? Changes);
public sealed class SettingsStore(AppDbContext db, IEventBus events) : ISettingsStore
{
    public async Task<T> Get<T>(string group, CancellationToken ct) where T : new() => JsonSerializer.Deserialize<T>((await Find(group, ct)).Json, JsonDefaults.Options) ?? new();
    public async Task<Setting> Find(string group, CancellationToken ct) => !SystemState.PublicGroups.Contains(group) ? throw ApiException.NotFound() : await db.Settings.SingleOrDefaultAsync(x => x.Group == group, ct) ?? throw ApiException.NotFound();
    public async Task<Setting> Update(string group, JsonElement body, HttpContext http, CancellationToken ct)
    {
        var item = await Find(group, ct);
        if (body.ValueKind != JsonValueKind.Object) throw ApiException.Validation("body", "须为 JSON 对象");
        long? version = body.TryGetProperty("version", out var v) && v.TryGetInt64(out var value) ? value : null;
        Input.Version(http, version, item.Version);
        var values = body.TryGetProperty("values", out var wrapped) ? wrapped : body;
        object validated = group switch
        {
            "site" => Validate(Merge<SiteSettings>(item.Json, values)),
            "appearance" => Validate(Merge<AppearanceSettings>(item.Json, values)),
            "security" => Validate(Merge<SecuritySettings>(item.Json, values)),
            "storage" => Validate(Merge<StorageSettings>(item.Json, values)),
            "speech" => Validate(Merge<SpeechSettings>(item.Json, values)),
            _ => throw ApiException.NotFound()
        };
        var before = JsonSerializer.Deserialize<JsonElement>(item.Json);
        item.Json = JsonDefaults.Serialize(validated); await db.SaveChangesAsync(ct);
        await events.Publish(new("settings.updated", "Setting", group, before, validated, new SettingChanged(group)), ct);
        return item;
    }
    private static T Merge<T>(string current, JsonElement incoming) where T : new()
    {
        var node = JsonNode.Parse(current)?.AsObject() ?? new JsonObject();
        if (incoming.ValueKind == JsonValueKind.Object)
            foreach (var property in incoming.EnumerateObject()) node[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        return node.Deserialize<T>(JsonDefaults.Options) ?? new T();
    }
    private static SiteSettings Validate(SiteSettings value)
    {
        value.ClassName = Input.Required(value.ClassName, "className", 100); value.ClassNameEn = Input.Optional(value.ClassNameEn, "classNameEn", 100); value.Slogan = Input.Required(value.Slogan, "slogan", 500); return value;
    }
    private static AppearanceSettings Validate(AppearanceSettings value)
    {
        if (!new[] { "high", "medium", "low", "static" }.Contains(value.ParticleQualityDefault)) throw ApiException.Validation("particleQualityDefault", "无效的粒子档位");
        if (!IsColor(value.ParticleColor) || !IsColor(value.AccentColor)) throw ApiException.Validation("particleColor", "颜色须为六位十六进制值");
        value.FontSubsetUrl = Input.Url(value.FontSubsetUrl, "fontSubsetUrl"); return value;
    }
    private static SecuritySettings Validate(SecuritySettings value)
    {
        if (value.RegistrationMode is not ("invite" or "closed")) throw ApiException.Validation("registrationMode", "须为 invite 或 closed");
        if (value.MinPasswordLength is < 12 or > 64 || value.SessionHours is < 1 or > 2160) throw ApiException.Validation("security", "密码最小长度 12–64，会话时长 1–2160 小时");
        return value;
    }
    private static bool IsColor(string? value) => value is not null && System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-fA-F]{6}$");
    private static StorageSettings Validate(StorageSettings value)
    {
        if (value.MaxUploadMb is < 1 or > 20 || value.AllowedTypes is null || value.AllowedTypes.Length == 0 || value.AllowedTypes.Except(new[] { "image/jpeg", "image/png", "image/gif", "image/webp" }).Any()) throw ApiException.Validation("storage", "上传限制须为 1–20 MB，类型限 JPEG/PNG/GIF/WebP");
        return value;
    }
    private static SpeechSettings Validate(SpeechSettings value)
    {
        if (value.DefaultSlotMinutes is < 1 or > 60 || value.MaxTeamSize is < 2 or > 20 || value.MaxCoursewareMb is < 1 or > 200) throw ApiException.Validation("speech", "时长须为 1–60 分钟，队伍人数 2–20，课件大小 1–200 MB");
        return value;
    }
    public static object View(Setting setting)
    {
        var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(setting.Json)!;
        var typed = JsonSerializer.Deserialize<object>(setting.Json, JsonDefaults.Options);
        return new { group = setting.Group, values = typed, version = setting.Version };
    }
    public static AuditView Audit(AuditEntry entry)
    {
        object[]? changes = null;
        if (entry.Before is not null || entry.After is not null)
            changes = [new { field = entry.ResourceType, before = entry.Before is null ? (object?)null : JsonSerializer.Deserialize<JsonElement>(entry.Before), after = entry.After is null ? (object?)null : JsonSerializer.Deserialize<JsonElement>(entry.After) }];
        return new(entry.Id, entry.CreatedAt, entry.Actor?.ToString() ?? "system", entry.Action, entry.ResourceType, entry.ResourceId, entry.Action, changes);
    }
}
public sealed class DependencyStatus(DatabaseConfig databaseConfig, IConfiguration config, IServiceProvider services)
{
    public async Task<(bool Database, bool? Mongo, bool? Redis)> Check(CancellationToken ct)
    {
        bool database; bool? mongo = null; bool? redis = null;
        try { database = databaseConfig.Configured && await services.GetRequiredService<AppDbContext>().Database.CanConnectAsync(ct); } catch { database = false; }
        if (config.GetValue<bool>("Mongo:Enabled"))
        {
            try { await services.GetRequiredService<IMongoDatabase>().RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: ct); mongo = true; } catch { mongo = false; }
        }
        if (config.GetValue<bool>("Redis:Enabled"))
        {
            try { await services.GetRequiredService<IConnectionMultiplexer>().GetDatabase().PingAsync().WaitAsync(ct); redis = true; } catch { redis = false; }
        }
        return (database, mongo, redis);
    }
}
public sealed class SiteAdminModule : IModule
{
    public string Name => "SiteAdmin";
    public IEnumerable<PermissionDefinition> DeclarePermissions() => new[] { "site.settings.read", "site.settings.write", "audit.read", "system.read", "system.manage" }.Select(x => new PermissionDefinition(x, Name, x));
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<ISettingsStore, SettingsStore>(); services.AddScoped<ISiteSettingsReader>(sp => sp.GetRequiredService<ISettingsStore>()); services.AddScoped<DependencyStatus>();
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/site/public", async (ISiteSettingsReader settings, IConfiguration config, ICacheService cache, CancellationToken ct) => await cache.Get("site:public", async token =>
        {
            var site = await settings.Get<SiteSettings>("site", token); var appearance = await settings.Get<AppearanceSettings>("appearance", token); var security = await settings.Get<SecuritySettings>("security", token);
            return new { site.ClassName, site.ClassNameEn, site.Slogan, appearance = new { appearance.ParticleQualityDefault, palette = new { particle = appearance.ParticleColor, accent = appearance.AccentColor }, appearance.FontSubsetUrl }, registrationMode = security.RegistrationMode, apiVersion = "v1", features = new { mongo = config.GetValue<bool>("Mongo:Enabled"), redis = config.GetValue<bool>("Redis:Enabled") } };
        }, ct)).WithTags("Site");
        endpoints.MapGet("/health/live", () => new { status = "healthy" }).WithTags("Health");
        endpoints.MapGet("/health/ready", async (DependencyStatus status, CancellationToken ct) =>
        {
            var check = await status.Check(ct); var healthy = check.Database && check.Mongo != false && check.Redis != false;
            return Results.Json(new { status = healthy ? "healthy" : "unhealthy", dependencies = new { database = check.Database, mongo = check.Mongo, redis = check.Redis } }, statusCode: healthy ? 200 : 503);
        }).WithTags("Health");
        var settingsGroup = endpoints.MapGroup("/api/v1/admin/settings").WithTags("Settings").RequireAuthorization();
        PluginEndpoints.Map(endpoints);
        settingsGroup.MapGet("", async (AppDbContext db, CancellationToken ct) => (await db.Settings.AsNoTracking().Where(x => SystemState.PublicGroups.Contains(x.Group)).ToListAsync(ct)).Select(SettingsStore.View).ToArray()).RequireAuthorization("site.settings.read");
        settingsGroup.MapGet("/{group}", async (string group, ISettingsStore settings, CancellationToken ct) => SettingsStore.View(await settings.Find(group, ct))).RequireAuthorization("site.settings.read");
        settingsGroup.MapPut("/{group}", async (string group, JsonElement body, ISettingsStore settings, HttpContext http, CancellationToken ct) => SettingsStore.View(await settings.Update(group, body, http, ct))).RequireAuthorization("site.settings.write");
        endpoints.MapGet("/api/v1/admin/audit-logs", async (IAuditStore store, HttpContext http, CancellationToken ct) => { var page = await store.List(http.Request, ct); return new Page<AuditView>(page.Items.Select(SettingsStore.Audit).ToArray(), page.Total, page.Number, page.PageSize); }).RequireAuthorization("audit.read").WithTags("Audit");
        endpoints.MapGet("/api/v1/admin/audit-logs/{id:guid}", async (Guid id, IAuditStore store, CancellationToken ct) => SettingsStore.Audit(await store.Get(id, ct) ?? throw ApiException.NotFound())).RequireAuthorization("audit.read").WithTags("Audit");
        endpoints.MapGet("/api/v1/admin/system/status", async (DependencyStatus status, AppDbContext db, DatabaseConfig databaseConfig, IConfiguration config, CancellationToken ct) =>
        {
            var check = await status.Check(ct);
            return new { version = "1.0.0", runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription, uptimeSeconds = (long)(DateTime.UtcNow - Process.GetCurrentProcess().StartTime.ToUniversalTime()).TotalSeconds, database = new { provider = databaseConfig.Provider == "PostgreSql" ? "Postgres" : databaseConfig.Provider, healthy = check.Database, migrationVersion = (await db.Database.GetAppliedMigrationsAsync(ct)).LastOrDefault() ?? "—" }, mongo = new { enabled = config.GetValue<bool>("Mongo:Enabled"), healthy = check.Mongo == true }, redis = new { enabled = config.GetValue<bool>("Redis:Enabled"), healthy = check.Redis == true } };
        }).RequireAuthorization("system.read").WithTags("System");
        endpoints.MapPost("/api/v1/admin/system/cache/clear", async (ICacheService cache, IEventBus events, CancellationToken ct) =>
        {
            await cache.Clear(ct); await events.Publish(new("system.cache_cleared", "System", "cache", null, null), ct); return Results.NoContent();
        }).RequireAuthorization("system.manage").WithTags("System");
    }
}
