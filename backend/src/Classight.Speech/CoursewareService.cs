using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;

namespace Classight.Speech;

public sealed class CoursewareService(AppDbContext db, CoursewareStore store, PreviewTokens tokens, IPresentationConverter converter, ConversionQueue queue, ISiteSettingsReader settings, ICurrentUser current, IClock clock, IEventBus events, IDistributedLock locks, SpeechService speech)
{
    private const long FormOverhead = 1024 * 1024;
    private static ApiException TooLarge(int mb) => new(413, "courseware.too_large", $"课件不能超过 {mb} MB");
    private bool Manage => current.Can("speech.manage");

    private async Task<(Courseware Item, SpeechEntry Entry, MeetingSession Session)> Load(Guid id, CancellationToken ct)
    {
        var item = await db.Coursewares.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        var entry = await db.SpeechEntries.AsNoTracking().SingleAsync(x => x.Id == item.EntryId, ct);
        var session = await speech.LoadSession(entry.SessionId, false, ct);
        return (item, entry, session);
    }

    private async Task EnsureCanChange(SpeechEntry entry, MeetingSession session, CancellationToken ct)
    {
        if (Manage) return;
        if (!current.Can("speech.participate")) throw ApiException.Forbidden();
        var me = current.Id ?? throw ApiException.Forbidden();
        var allowed = entry.OwnerId == me || entry.TeamId is { } teamId && await db.SpeechTeamMembers.AnyAsync(x => x.TeamId == teamId && x.UserId == me, ct);
        if (!allowed) throw ApiException.Forbidden();
        if (session.Status is not (SpeechStatus.Open or SpeechStatus.Running) || entry.Status is not (SpeechStatus.Queued or SpeechStatus.Speaking)) throw new ApiException(403, "speech.closed", "本场次未开放或条目已结束，不能修改课件");
    }

    private PersonRef Person(User? user, Guid id) => user is null ? new(id, "已删除用户", null) : new(user.Id, user.DisplayName, user.AvatarId is { } avatar ? $"/api/v1/media/{avatar}" : null);
    private async Task<CoursewareView> View(Courseware item, CancellationToken ct) =>
        CoursewareMapper.View(item, Person(await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == item.UploaderId, ct), item.UploaderId));

    public async Task<CoursewareView> Get(Guid id, CancellationToken ct) => await View((await Load(id, ct)).Item, ct);

    public async Task<CoursewareView> Upload(Guid entryId, HttpContext http, CancellationToken ct)
    {
        var entry = await db.SpeechEntries.AsNoTracking().SingleOrDefaultAsync(x => x.Id == entryId, ct) ?? throw ApiException.NotFound();
        var session = await speech.LoadSession(entry.SessionId, false, ct);
        await EnsureCanChange(entry, session, ct);
        if (!http.Request.HasFormContentType) throw ApiException.Validation("file", "须为 multipart/form-data");
        var policy = await settings.Get<SpeechSettings>("speech", ct);
        var limit = policy.MaxCoursewareMb * 1024L * 1024;
        if (http.Request.ContentLength > limit + FormOverhead) throw TooLarge(policy.MaxCoursewareMb);
        // Per-endpoint limits: the global 21MB cap stays untouched, this request alone is allowed up to the configured size.
        if (http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodyLimit) bodyLimit.MaxRequestBodySize = limit + FormOverhead;
        http.Features.Set<IFormFeature>(new FormFeature(http.Request, new FormOptions { MultipartBodyLengthLimit = limit + FormOverhead, BufferBodyLengthLimit = limit + FormOverhead }));
        IFormCollection form;
        try { form = await http.Request.ReadFormAsync(ct); }
        catch (InvalidDataException) { throw TooLarge(policy.MaxCoursewareMb); }
        catch (BadHttpRequestException ex) when (ex.StatusCode == 413) { throw TooLarge(policy.MaxCoursewareMb); }
        var file = form.Files.GetFile("file") ?? throw ApiException.Validation("file", "缺少文件");
        if (file.Length == 0) throw ApiException.Validation("file", "文件为空");
        if (file.Length > limit) throw TooLarge(policy.MaxCoursewareMb);
        var name = CleanName(file.FileName);

        await using var _ = await locks.Acquire(SpeechService.LockKey(entry.SessionId), ct);
        // Re-validate under the lock: the entry may have been removed while the upload was in flight.
        entry = await db.SpeechEntries.AsNoTracking().SingleOrDefaultAsync(x => x.Id == entryId, ct) ?? throw ApiException.NotFound();
        var newId = Guid.CreateVersion7();
        DetectedFile detected;
        await using (var stream = file.OpenReadStream()) detected = await store.Save(newId, stream, name, ct);
        Courseware item; Courseware? old;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            old = await db.Coursewares.SingleOrDefaultAsync(x => x.EntryId == entryId, ct);
            if (old is not null) { db.Coursewares.Remove(old); await db.SaveChangesAsync(ct); }
            var convert = detected.Kind is "ppt" or "pptx" && converter.Available;
            item = new Courseware
            {
                Id = newId, EntryId = entryId, UploaderId = current.Id ?? throw ApiException.Forbidden(), Kind = detected.Kind, OriginalName = name, StorageKey = newId.ToString("N"), Size = file.Length,
                ConversionStatus = convert ? "converting" : "none", WebEntry = detected.WebEntry, CreatedAt = clock.UtcNow
            };
            db.Coursewares.Add(item); await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch { store.Delete(newId); throw; }
        if (old is not null) store.Delete(old.Id);
        if (item.ConversionStatus == "converting") queue.Enqueue(item.Id);
        await events.Publish(new(old is null ? "courseware.uploaded" : "courseware.replaced", "Courseware", item.Id.ToString(), old is null ? null : new { old.Id, old.Kind, old.OriginalName }, new { item.EntryId, item.Kind, item.OriginalName, item.Size }), ct);
        return await View(item, ct);
    }

    private static string CleanName(string? raw)
    {
        var name = Path.GetFileName((raw ?? "").Replace('\\', '/')).Trim();
        name = new string(name.Where(c => !char.IsControl(c)).ToArray());
        if (name.Length > 200) name = name[^200..];
        return name.Length == 0 ? "courseware" : name;
    }

    public async Task Delete(Guid id, CancellationToken ct)
    {
        var (item, entry, session) = await Load(id, ct);
        await EnsureCanChange(entry, session, ct);
        await using var _ = await locks.Acquire(SpeechService.LockKey(entry.SessionId), ct);
        var tracked = await db.Coursewares.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        db.Coursewares.Remove(tracked); await db.SaveChangesAsync(ct);
        store.Delete(id);
        await events.Publish(new("courseware.deleted", "Courseware", id.ToString(), new { item.EntryId, item.Kind, item.OriginalName }, null), ct);
    }

    public async Task<PreviewTicket> Ticket(Guid id, CancellationToken ct)
    {
        var (item, _, _) = await Load(id, ct);
        var mode = CoursewareMapper.PreviewMode(item);
        var (token, expires) = tokens.Create(id);
        var url = mode switch
        {
            "pdf" or "pptx" => $"/api/v1/speech/preview/{token}/file",
            "web" => $"/api/v1/speech/preview/{token}/site/{Uri.EscapeDataString(item.WebEntry ?? "index.html")}",
            _ => ""
        };
        return new(mode, url, expires, item.OriginalName);
    }

    public async Task<IResult> Download(Guid id, CancellationToken ct)
    {
        var (item, _, _) = await Load(id, ct);
        var path = store.OriginalPath(id);
        if (!File.Exists(path)) throw ApiException.NotFound();
        return Results.File(path, OriginalContentType(item.Kind), item.OriginalName, enableRangeProcessing: true);
    }

    private static string OriginalContentType(string kind) => kind switch
    {
        "pdf" => "application/pdf",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ppt" => "application/vnd.ms-powerpoint",
        _ => "application/zip"
    };

    // ---- anonymous, signature-protected preview resources

    private async Task<Courseware> FromToken(string token, CancellationToken ct)
    {
        var id = tokens.Validate(token);
        return await db.Coursewares.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
    }

    public async Task<IResult> PreviewFile(string token, HttpContext http, CancellationToken ct)
    {
        var item = await FromToken(token, ct);
        var mode = CoursewareMapper.PreviewMode(item);
        string path, type;
        switch (mode)
        {
            case "pdf" when item.Kind != "pdf": path = store.PdfPath(item.Id); type = "application/pdf"; break;
            case "pdf": path = store.OriginalPath(item.Id); type = "application/pdf"; break;
            case "pptx": path = store.OriginalPath(item.Id); type = OriginalContentType("pptx"); break;
            default: throw ApiException.NotFound();
        }
        if (!File.Exists(path)) throw ApiException.NotFound();
        SetPreviewHeaders(http);
        http.Response.Headers.ContentDisposition = "inline; filename*=UTF-8''" + Uri.EscapeDataString(item.OriginalName);
        return Results.File(path, type, enableRangeProcessing: true);
    }

    public async Task<IResult> PreviewSite(string token, string? path, HttpContext http, CancellationToken ct)
    {
        var item = await FromToken(token, ct);
        if (item.Kind != "web" || item.WebEntry is null) throw ApiException.NotFound();
        var file = store.ResolveSiteFile(item.Id, path, item.WebEntry) ?? throw ApiException.NotFound();
        SetPreviewHeaders(http);
        // The page is user-supplied code: it runs in an opaque origin and cannot reach the parent page or the API with the visitor's credentials.
        http.Response.Headers["Content-Security-Policy"] = "sandbox allow-scripts";
        return Results.File(file, CoursewareStore.ContentTypeFor(Path.GetExtension(file)), enableRangeProcessing: true);
    }

    private static void SetPreviewHeaders(HttpContext http)
    {
        http.Response.Headers.CacheControl = "private, max-age=600";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers["Access-Control-Allow-Origin"] = "*";
        http.Response.Headers["Referrer-Policy"] = "no-referrer";
    }
}
