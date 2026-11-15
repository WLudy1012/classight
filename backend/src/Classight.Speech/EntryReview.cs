using System.Buffers.Text;
using System.Text.Json;
using Classight.Platform;
using Microsoft.EntityFrameworkCore;

namespace Classight.Speech;

internal sealed record EntryReview(string Status = "pending", string? Note = null, Guid? DisplayId = null);

internal static class EntryReviews
{
    private static string Key(Guid id) => "speech:r:" + Base64Url.EncodeToString(id.ToByteArray());

    internal static async Task<Dictionary<Guid, EntryReview>> Read(AppDbContext db, IEnumerable<Guid> ids, CancellationToken ct)
    {
        var keys = ids.Distinct().ToDictionary(Key);
        var rows = await db.Settings.AsNoTracking().Where(x => keys.Keys.Contains(x.Group)).ToListAsync(ct);
        return rows.ToDictionary(x => keys[x.Group], x => Parse(x));
    }

    internal static async Task<EntryReview> ReadOne(AppDbContext db, Guid id, CancellationToken ct) =>
        Parse(await db.Settings.AsNoTracking().SingleOrDefaultAsync(x => x.Group == Key(id), ct));

    internal static async Task Set(AppDbContext db, SpeechEntry entry, EntryReview review, CancellationToken ct)
    {
        var key = Key(entry.Id);
        var row = await db.Settings.SingleOrDefaultAsync(x => x.Group == key, ct);
        if (row is null && review.Status != "pending")
            db.Settings.Add(new Setting { Group = key, Json = JsonDefaults.Serialize(review) });
        else if (row is not null && review.Status == "pending")
            db.Settings.Remove(row);
        else if (row is not null)
            row.Json = JsonDefaults.Serialize(review);
        db.Entry(entry).Property(x => x.Version).IsModified = true;
    }

    internal static async Task Remove(AppDbContext db, IEnumerable<Guid> ids, CancellationToken ct)
    {
        var keys = ids.Select(Key).ToArray();
        db.Settings.RemoveRange(await db.Settings.Where(x => keys.Contains(x.Group)).ToListAsync(ct));
    }

    private static EntryReview Parse(Setting? row) =>
        row is null ? new() : JsonSerializer.Deserialize<EntryReview>(row.Json, JsonDefaults.Options) ?? new();
}
