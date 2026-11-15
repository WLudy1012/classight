using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Classight.Speech;

public sealed partial class SpeechService
{
    private static ApiException ReviewRequired() => new(409, "speech.review_required", "请先通过审核");

    public async Task<SpeechEntryView> Review(Guid id, EntryReviewRequest body, HttpContext http, CancellationToken ct)
    {
        if (body.Status is not ("approved" or "returned")) throw ApiException.Validation("status", "请选择通过或退回");
        var note = body.Status == "returned" ? Input.Required(body.Note, "note", 500) : null;
        var sessionId = await SessionIdOfEntry(id, ct);
        await using var lease = await locks.Acquire(LockKey(sessionId), ct);
        await LoadSession(sessionId, false, ct);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        if (entry.Status is not (SpeechStatus.Queued or SpeechStatus.Skipped)) throw ApiException.Conflict("只能审核待发言或已跳过的条目");
        Input.Version(http, body.Version, entry.Version);
        var before = await EntryReviews.ReadOne(db, id, ct);
        await EntryReviews.Set(db, entry, new(body.Status, note), ct);
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.entry.reviewed", "SpeechEntry", id.ToString(), before, new { body.Status, note }), ct);
        return (await EntryViews([entry], ct))[0];
    }

    private async Task StopDisplay(SpeechEntry entry, CancellationToken ct)
    {
        var review = await EntryReviews.ReadOne(db, entry.Id, ct);
        if (review.DisplayId is not null) await EntryReviews.Set(db, entry, review with { DisplayId = null }, ct);
    }

    public async Task<Page<PersonRef>> GroupCandidates(Guid sessionId, HttpRequest request, CancellationToken ct)
    {
        await LoadSession(sessionId, false, ct);
        var query = db.Users.AsNoTracking().Where(x => !x.Deleted && !x.Disabled);
        var search = request.Query["q"].ToString().Trim();
        if (search.Length > 100) throw ApiException.Validation("q", "搜索词过长");
        if (search.Length > 0) query = query.Where(x => x.DisplayName.Contains(search) || x.Username.Contains(search));
        var (page, size) = Input.Paging(request);
        var total = await query.CountAsync(ct);
        var users = await query.OrderBy(x => x.DisplayName).ThenBy(x => x.Id).Skip((page - 1) * size).Take(size).ToListAsync(ct);
        return new(users.Select(x => new PersonRef(x.Id, x.DisplayName, null)).ToArray(), total, page, size);
    }

    public async Task<SpeechTeamView> AssignTeam(Guid sessionId, Guid? teamId, AssignedTeamRequest body, HttpContext http, CancellationToken ct)
    {
        var name = Input.Required(body.Name, "name", 100);
        var ids = body.MemberIds ?? [];
        await using var lease = await locks.Acquire(LockKey(sessionId), ct);
        var session = await LoadSession(sessionId, false, ct);
        if (!session.AllowTeams) throw new ApiException(403, "speech.teams_disabled", "本场次不允许组队");
        if (session.Status == SpeechStatus.Closed) throw Closed();
        if (ids.Length < 2 || ids.Length > session.MaxTeamSize || ids.Distinct().Count() != ids.Length || !ids.Contains(body.LeaderId))
            throw ApiException.Validation("memberIds", $"须选择 2–{session.MaxTeamSize} 名不重复的成员，队长须在组内");
        if (await db.Users.CountAsync(x => ids.Contains(x.Id) && !x.Deleted && !x.Disabled, ct) != ids.Length)
            throw ApiException.Validation("memberIds", "存在不可用的成员账号");
        var otherMembers = db.SpeechTeamMembers.Where(x => x.SessionId == sessionId && ids.Contains(x.UserId));
        if (teamId is { } currentTeamId) otherMembers = otherMembers.Where(x => x.TeamId != currentTeamId);
        if (await otherMembers.AnyAsync(ct)) throw new ApiException(409, "speech.team_exists", "成员已在本场次其他小组");

        var team = teamId is { } existingId
            ? await db.SpeechTeams.SingleOrDefaultAsync(x => x.Id == existingId && x.SessionId == sessionId, ct) ?? throw ApiException.NotFound()
            : new SpeechTeam { SessionId = sessionId, CreatedAt = clock.UtcNow };
        if (teamId is not null) Input.Version(http, body.Version, team.Version);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.TeamId == team.Id, ct);
        var soloEntries = await db.SpeechEntries.Where(x => x.SessionId == sessionId && x.TeamId == null && ids.Contains(x.OwnerId)).ToListAsync(ct);
        if (soloEntries.Any(x => entry is not null || x.OwnerId != body.LeaderId))
            throw new ApiException(409, "speech.already_signed_up", "成员已有独立报名，请先处理该报名");
        entry ??= soloEntries.SingleOrDefault();
        if (entry is not null)
        {
            if (entry.Status != SpeechStatus.Queued) throw ApiException.Conflict("发言开始后不能调整分组");
            entry.OwnerId = body.LeaderId;
            entry.TeamId = team.Id;
            await EntryReviews.Set(db, entry, new(), ct);
        }

        team.Name = name;
        team.LeaderId = body.LeaderId;
        if (!Assigned(team)) team.JoinCode = await NewJoinCode(ct, "!");
        if (teamId is null) db.SpeechTeams.Add(team);
        else db.Entry(team).Property(x => x.Version).IsModified = true;
        var members = await db.SpeechTeamMembers.Where(x => x.TeamId == team.Id).ToListAsync(ct);
        db.SpeechTeamMembers.RemoveRange(members.Where(x => !ids.Contains(x.UserId)));
        foreach (var id in ids.Except(members.Select(x => x.UserId)))
            db.SpeechTeamMembers.Add(new SpeechTeamMember { SessionId = sessionId, TeamId = team.Id, UserId = id, CreatedAt = clock.UtcNow });
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.team.assigned", "SpeechTeam", team.Id.ToString(), null, new { sessionId, name, body.LeaderId, memberIds = ids }), ct);
        return await TeamViewOf(team, ct);
    }
}
