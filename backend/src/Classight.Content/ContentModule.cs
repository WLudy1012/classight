using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Content;

public sealed class MediaService(AppDbContext db, IMediaStorage storage, ISiteSettingsReader settings, ICurrentUser current, IEventBus events)
{
    public async Task<MediaAsset> Upload(HttpContext http, bool avatar, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType) throw ApiException.Validation("file", "须为 multipart/form-data");
        var form = await http.Request.ReadFormAsync(ct); var file = form.Files.GetFile("file") ?? throw ApiException.Validation("file", "缺少文件");
        var policy = await settings.Get<StorageSettings>("storage", ct); var max = (avatar ? Math.Min(5, policy.MaxUploadMb) : policy.MaxUploadMb) * 1024L * 1024;
        if (file.Length == 0 || file.Length > max) throw ApiException.Validation("file", $"文件大小须为 1–{max} 字节");
        await using var input = file.OpenReadStream(); var header = new byte[16]; var length = await input.ReadAtLeastAsync(header, 12, false, ct); input.Position = 0;
        var type = Detect(header.AsSpan(0, length));
        if (type is null || type != file.ContentType.ToLowerInvariant() || !policy.AllowedTypes.Contains(type)) throw new ApiException(422, "media.unsupported_type", "文件内容与允许的图片格式不符");
        var isPublic = avatar;
        if (!avatar && form.TryGetValue("isPublic", out var value))
        {
            if (!bool.TryParse(value, out isPublic)) throw ApiException.Validation("isPublic", "须为布尔值");
        }
        var item = new MediaAsset { OwnerId = current.Id!.Value, StorageKey = Guid.CreateVersion7().ToString("N"), ContentType = type, Size = file.Length, Public = isPublic };
        await storage.Write(item.StorageKey, input, ct);
        try { db.Media.Add(item); await db.SaveChangesAsync(ct); }
        catch { await storage.Delete(item.StorageKey, CancellationToken.None); throw; }
        await events.Publish(new("media.uploaded", "Media", item.Id.ToString(), null, new { item.Id, item.ContentType, item.Size, item.Public }), ct);
        return item;
    }
    private static string? Detect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        if (bytes.Length >= 6 && (bytes[..6].SequenceEqual("GIF87a"u8) || bytes[..6].SequenceEqual("GIF89a"u8))) return "image/gif";
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }
}
public sealed class ContentModule : IModule
{
    public string Name => "Content";
    public IEnumerable<PermissionDefinition> DeclarePermissions() => new[] { "content.manage", "media.upload" }.Select(x => new PermissionDefinition(x, Name, x));
    public void AddServices(IServiceCollection services, IConfiguration configuration) => services.AddScoped<MediaService>();
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/media", async (MediaService service, HttpContext http, CancellationToken ct) =>
        {
            var item = await service.Upload(http, false, ct); return Results.Created($"/api/v1/media/{item.Id}", new { item.Id, url = $"/api/v1/media/{item.Id}", item.ContentType, item.Size });
        }).RequireAuthorization("media.upload").WithTags("Media").Accepts<IFormFile>("multipart/form-data");
        endpoints.MapGet("/api/v1/media/{id:guid}", async (Guid id, AppDbContext db, IMediaStorage storage, ICurrentUser current, HttpContext http, CancellationToken ct) =>
        {
            var item = await db.Media.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
            if (!item.Public && item.OwnerId != current.Id && !current.Can("content.manage")) throw ApiException.NotFound();
            http.Response.Headers.CacheControl = item.Public ? "public,max-age=86400,immutable" : "private,no-store";
            http.Response.Headers.XContentTypeOptions = "nosniff";
            var tag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue("\"" + item.Id.ToString("N") + "-" + item.Version + "\"");
            try { return Results.Stream(await storage.Read(item.StorageKey, ct), item.ContentType, lastModified: item.CreatedAt, entityTag: tag, enableRangeProcessing: true); }
            catch (FileNotFoundException) { throw ApiException.NotFound(); }
        }).WithTags("Media");
        endpoints.MapPut("/api/v1/me/avatar", async (MediaService service, AppDbContext db, ICurrentUser current, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(x => x.Id == current.Id, ct); Input.Version(http, null, user.Version);
            var item = await service.Upload(http, true, ct); var before = user.AvatarId;
            user.AvatarId = item.Id; await db.SaveChangesAsync(ct); await events.Publish(new("user.avatar_changed", "User", user.Id.ToString(), new { avatarId = before }, new { user.AvatarId }), ct);
            return new { avatarUrl = $"/api/v1/media/{item.Id}" };
        }).RequireAuthorization().WithTags("Me").Accepts<IFormFile>("multipart/form-data");
        endpoints.MapDelete("/api/v1/me/avatar", async (AppDbContext db, ICurrentUser current, IEventBus events, HttpContext http, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(x => x.Id == current.Id, ct); Input.Version(http, null, user.Version); var before = user.AvatarId; user.AvatarId = null;
            await db.SaveChangesAsync(ct); await events.Publish(new("user.avatar_deleted", "User", user.Id.ToString(), new { avatarId = before }, null), ct); return Results.NoContent();
        }).RequireAuthorization().WithTags("Me");
    }
}
