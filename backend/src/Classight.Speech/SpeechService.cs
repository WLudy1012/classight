using System.Security.Cryptography;
using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Classight.Speech;

public sealed class SpeechService(AppDbContext db, ISiteSettingsReader settings, ICurrentUser current, IClock clock, IEventBus events, IDistributedLock locks, CoursewareStore store, IPresentationConverter converter)
{
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly string[] Statuses = [SpeechStatus.Draft, SpeechStatus.Open, SpeechStatus.Running, SpeechStatus.Closed];
    private static readonly HashSet<(string From, string To)> Transitions = [(SpeechStatus.Draft, SpeechStatus.Open), (SpeechStatus.Open, SpeechStatus.Running), (SpeechStatus.Running, SpeechStatus.Closed), (SpeechStatus.Running, SpeechStatus.Open), (SpeechStatus.Closed, SpeechStatus.Open)];
    private static readonly Dictionary<string, string> SessionSort = new() { ["date"] = "Date", ["createdAt"] = "CreatedAt", ["title"] = "Title" };

    private Guid Me => current.Id ?? throw ApiException.Forbidden();
    private bool Manage => current.Can("speech.manage");
    private static ApiException AlreadySignedUp() => new(409, "speech.already_signed_up", "你在本场次已有排队条目");
    private static ApiException Closed() => new(403, "speech.closed", "本场次未开放报名或已结束");
    private static ApiException NotLeader() => new(403, "speech.not_leader", "需要队长权限");

    // ---------------------------------------------------------------- queries

    public async Task<CapabilitiesView> Capabilities(CancellationToken ct)
    {
        var policy = await settings.Get<SpeechSettings>("speech", ct);
        return new(converter.Available, policy.MaxCoursewareMb, ["pptx", "ppt", "pdf", "web"], new(policy.DefaultSlotMinutes, policy.AllowTeams, policy.MaxTeamSize));
    }

    public async Task<Page<SpeechSessionView>> ListSessions(HttpRequest request, bool includeDraft, CancellationToken ct)
    {
        var query = db.MeetingSessions.AsNoTracking().Where(x => !x.Deleted);
        if (!includeDraft || !Manage) query = query.Where(x => x.Status != SpeechStatus.Draft);
        if (request.Query.TryGetValue("status", out var status))
        {
            var value = status.ToString();
            if (!Statuses.Contains(value)) throw ApiException.Validation("status", "无效的场次状态");
            query = query.Where(x => x.Status == value);
        }
        var (page, size) = Input.Paging(request); var total = await query.CountAsync(ct);
        var items = await QuerySort.Apply(query, request, "-date", SessionSort).Skip((page - 1) * size).Take(size).ToListAsync(ct);
        var ids = items.Select(x => x.Id).ToList();
        var counts = await db.SpeechEntries.AsNoTracking().Where(x => ids.Contains(x.SessionId)).GroupBy(x => x.SessionId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var speaking = await db.SpeechEntries.AsNoTracking().Where(x => ids.Contains(x.SessionId) && x.Status == SpeechStatus.Speaking).Select(x => new { x.SessionId, x.Id }).ToListAsync(ct);
        return new(items.Select(x => SessionView(x, counts.GetValueOrDefault(x.Id), speaking.FirstOrDefault(s => s.SessionId == x.Id)?.Id)).ToArray(), total, page, size);
    }

    public async Task<SpeechSessionDetailView> GetSession(Guid id, CancellationToken ct)
    {
        var session = await LoadSession(id, false, ct);
        var entries = await db.SpeechEntries.AsNoTracking().Where(x => x.SessionId == id).OrderBy(x => x.Position).ThenBy(x => x.CreatedAt).ToListAsync(ct);
        var teams = await db.SpeechTeams.AsNoTracking().Where(x => x.SessionId == id).OrderBy(x => x.CreatedAt).ToListAsync(ct);
        var lookup = await Lookup.Build(db, entries, teams, ct);
        var entryViews = entries.Select(x => EntryView(x, lookup)).ToArray();
        var teamViews = teams.Select(x => TeamView(x, lookup, entries.FirstOrDefault(e => e.TeamId == x.Id)?.Id)).ToArray();
        var myTeam = lookup.Members.SelectMany(g => g).FirstOrDefault(m => m.SessionId == id && m.UserId == Me)?.TeamId;
        var mine = entryViews.FirstOrDefault(x => x.Mine)?.Id;
        var summary = SessionView(session, entries.Count, entries.FirstOrDefault(x => x.Status == SpeechStatus.Speaking)?.Id);
        return new(summary.Id, summary.Title, summary.Date, summary.Description, summary.SlotMinutes, summary.AllowTeams, summary.MaxTeamSize, summary.SubmissionsOpen, summary.Status, summary.EntryCount, summary.CurrentEntryId, summary.Version, summary.CreatedAt, entryViews, teamViews, mine, myTeam);
    }

    public async Task<SpeechEntryView> GetEntryView(Guid id, CancellationToken ct)
    {
        var entry = await db.SpeechEntries.AsNoTracking().SingleAsync(x => x.Id == id, ct);
        return (await EntryViews([entry], ct))[0];
    }

    // ---------------------------------------------------------------- participant: entries

    public async Task<SpeechEntryView> SignUp(Guid sessionId, EntryCreateRequest body, CancellationToken ct)
    {
        var topic = Input.Required(body.Topic, "topic", 200);
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var session = await LoadSession(sessionId, true, ct);
        EnsureOpenForSignup(session);
        var entry = await CreateEntry(session, Me, topic, body.TeamId, ct);
        await events.Publish(new("speech.entry.created", "SpeechEntry", entry.Id.ToString(), null, new { entry.SessionId, entry.OwnerId, entry.TeamId, entry.Topic, entry.Position }), ct);
        return (await EntryViews([entry], ct))[0];
    }

    public async Task<SpeechEntryView> AdminSignUp(Guid sessionId, AdminEntryCreateRequest body, CancellationToken ct)
    {
        var topic = Input.Required(body.Topic, "topic", 200);
        if (!await db.Users.AnyAsync(x => x.Id == body.OwnerId && !x.Deleted, ct)) throw ApiException.Validation("ownerId", "用户不存在");
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var session = await LoadSession(sessionId, true, ct);
        var entry = await CreateEntry(session, body.OwnerId, topic, body.TeamId, ct);
        await events.Publish(new("speech.entry.created", "SpeechEntry", entry.Id.ToString(), null, new { entry.SessionId, entry.OwnerId, entry.TeamId, entry.Topic, entry.Position, proxy = true }), ct);
        return (await EntryViews([entry], ct))[0];
    }

    private async Task<SpeechEntry> CreateEntry(MeetingSession session, Guid ownerId, string topic, Guid? teamId, CancellationToken ct)
    {
        if (await db.SpeechEntries.AnyAsync(x => x.SessionId == session.Id && x.OwnerId == ownerId, ct)) throw AlreadySignedUp();
        var membership = await db.SpeechTeamMembers.AsNoTracking().SingleOrDefaultAsync(x => x.SessionId == session.Id && x.UserId == ownerId, ct);
        if (teamId is null)
        {
            if (membership is not null)
                throw await db.SpeechEntries.AnyAsync(x => x.TeamId == membership.TeamId, ct) ? AlreadySignedUp() : new ApiException(409, "speech.team_exists", "你已在本场次的队伍中，请以队伍名义报名或先退出队伍");
        }
        else
        {
            var team = await db.SpeechTeams.AsNoTracking().SingleOrDefaultAsync(x => x.Id == teamId && x.SessionId == session.Id, ct) ?? throw ApiException.NotFound();
            if (team.LeaderId != ownerId) throw NotLeader();
            if (await db.SpeechEntries.AnyAsync(x => x.TeamId == team.Id, ct)) throw AlreadySignedUp();
        }
        var position = (await db.SpeechEntries.Where(x => x.SessionId == session.Id).MaxAsync(x => (int?)x.Position, ct) ?? 0) + 1;
        var entry = new SpeechEntry { SessionId = session.Id, Position = position, OwnerId = ownerId, TeamId = teamId, Topic = topic, Status = SpeechStatus.Queued, CreatedAt = clock.UtcNow };
        db.SpeechEntries.Add(entry); await db.SaveChangesAsync(ct);
        return entry;
    }

    public async Task<SpeechEntryView> PatchEntry(Guid id, EntryPatchRequest body, HttpContext http, CancellationToken ct)
    {
        var topic = Input.Required(body.Topic, "topic", 200);
        var sessionId = await SessionIdOfEntry(id, ct);
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        var session = await LoadSession(entry.SessionId, false, ct);
        if (!Manage) { RequireParticipant(); if (entry.OwnerId != Me) throw ApiException.Forbidden(); EnsureActive(session); if (entry.Status != SpeechStatus.Queued) throw ApiException.Conflict("条目已开始或结束，不可修改"); }
        Input.Version(http, body.Version, entry.Version);
        var before = new { entry.Topic };
        entry.Topic = topic; await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.entry.updated", "SpeechEntry", entry.Id.ToString(), before, new { entry.Topic }), ct);
        return (await EntryViews([entry], ct))[0];
    }

    public async Task DeleteEntry(Guid id, CancellationToken ct)
    {
        var sessionId = await SessionIdOfEntry(id, ct);
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        var session = await LoadSession(entry.SessionId, false, ct);
        if (!Manage) { RequireParticipant(); if (entry.OwnerId != Me) throw ApiException.Forbidden(); EnsureActive(session); if (entry.Status != SpeechStatus.Queued) throw ApiException.Conflict("条目已开始或结束，不可取消"); }
        await RemoveEntry(entry, ct);
        await events.Publish(new("speech.entry.deleted", "SpeechEntry", entry.Id.ToString(), new { entry.SessionId, entry.OwnerId, entry.TeamId, entry.Topic }, null), ct);
    }

    private async Task RemoveEntry(SpeechEntry entry, CancellationToken ct)
    {
        var coursewares = await db.Coursewares.Where(x => x.EntryId == entry.Id).ToListAsync(ct);
        db.Coursewares.RemoveRange(coursewares); db.SpeechEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        foreach (var item in coursewares) store.Delete(item.Id);
        await Renumber(entry.SessionId, ct);
    }

    private async Task Renumber(Guid sessionId, CancellationToken ct)
    {
        var entries = await db.SpeechEntries.Where(x => x.SessionId == sessionId).OrderBy(x => x.Position).ThenBy(x => x.CreatedAt).ToListAsync(ct);
        var position = 1; var changed = false;
        foreach (var entry in entries) { if (entry.Position != position) { entry.Position = position; changed = true; } position++; }
        if (changed) await db.SaveChangesAsync(ct);
    }

    // ---------------------------------------------------------------- participant: teams

    public async Task<SpeechTeamView> CreateTeam(Guid sessionId, TeamCreateRequest body, CancellationToken ct)
    {
        var name = Input.Required(body.Name, "name", 100);
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var session = await LoadSession(sessionId, false, ct);
        if (!session.AllowTeams) throw new ApiException(403, "speech.teams_disabled", "本场次不允许组队");
        EnsureOpenForSignup(session);
        var me = Me;
        if (await db.SpeechEntries.AnyAsync(x => x.SessionId == sessionId && x.OwnerId == me, ct)) throw AlreadySignedUp();
        if (await db.SpeechTeamMembers.AnyAsync(x => x.SessionId == sessionId && x.UserId == me, ct)) throw new ApiException(409, "speech.team_exists", "你已在本场次的另一支队伍里");
        var team = new SpeechTeam { SessionId = sessionId, Name = name, LeaderId = me, JoinCode = await NewJoinCode(ct), CreatedAt = clock.UtcNow };
        db.SpeechTeams.Add(team);
        db.SpeechTeamMembers.Add(new SpeechTeamMember { SessionId = sessionId, TeamId = team.Id, UserId = me, CreatedAt = clock.UtcNow });
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.team.created", "SpeechTeam", team.Id.ToString(), null, new { team.SessionId, team.Name, team.LeaderId }), ct);
        return await TeamViewOf(team, ct);
    }

    public async Task<SpeechTeamView> JoinTeam(TeamJoinRequest body, CancellationToken ct)
    {
        var code = Input.Required(body.Code, "code", 16).ToUpperInvariant();
        var sessionId = await db.SpeechTeams.AsNoTracking().Where(x => x.JoinCode == code).Select(x => (Guid?)x.SessionId).SingleOrDefaultAsync(ct) ?? throw new ApiException(404, "resource.not_found", "加入码无效");
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var team = await db.SpeechTeams.SingleOrDefaultAsync(x => x.JoinCode == code, ct) ?? throw new ApiException(404, "resource.not_found", "加入码无效");
        var session = await LoadSession(team.SessionId, false, ct);
        if (!session.AllowTeams) throw new ApiException(403, "speech.teams_disabled", "本场次不允许组队");
        EnsureOpenForSignup(session);
        var me = Me;
        var existing = await db.SpeechTeamMembers.AsNoTracking().SingleOrDefaultAsync(x => x.SessionId == session.Id && x.UserId == me, ct);
        if (existing?.TeamId == team.Id) return await TeamViewOf(team, ct);
        if (await db.SpeechEntries.AnyAsync(x => x.SessionId == session.Id && x.OwnerId == me, ct)) throw AlreadySignedUp();
        if (existing is not null) throw new ApiException(409, "speech.team_exists", "你已在本场次的另一支队伍里");
        if (await db.SpeechTeamMembers.CountAsync(x => x.TeamId == team.Id, ct) >= session.MaxTeamSize) throw new ApiException(409, "speech.team_full", "队伍已满");
        db.SpeechTeamMembers.Add(new SpeechTeamMember { SessionId = session.Id, TeamId = team.Id, UserId = me, CreatedAt = clock.UtcNow });
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.team.joined", "SpeechTeam", team.Id.ToString(), null, new { team.SessionId, userId = me }), ct);
        return await TeamViewOf(team, ct);
    }

    public async Task RemoveMember(Guid teamId, Guid userId, CancellationToken ct)
    {
        var sessionId = await db.SpeechTeams.AsNoTracking().Where(x => x.Id == teamId).Select(x => (Guid?)x.SessionId).SingleOrDefaultAsync(ct) ?? throw ApiException.NotFound();
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var team = await db.SpeechTeams.SingleOrDefaultAsync(x => x.Id == teamId, ct) ?? throw ApiException.NotFound();
        var session = await LoadSession(team.SessionId, false, ct);
        var member = await db.SpeechTeamMembers.SingleOrDefaultAsync(x => x.TeamId == teamId && x.UserId == userId, ct) ?? throw ApiException.NotFound();
        var self = userId == Me;
        if (!Manage)
        {
            RequireParticipant();
            if (!self && team.LeaderId != Me) throw NotLeader();
            EnsureActive(session);
        }
        if (userId == team.LeaderId) throw ApiException.Conflict("队长不能退队，请先解散队伍");
        db.SpeechTeamMembers.Remove(member); await db.SaveChangesAsync(ct);
        await events.Publish(new(self ? "speech.team.left" : "speech.team.kicked", "SpeechTeam", team.Id.ToString(), new { team.SessionId, userId }, null), ct);
    }

    public async Task DisbandTeam(Guid teamId, CancellationToken ct)
    {
        var sessionId = await db.SpeechTeams.AsNoTracking().Where(x => x.Id == teamId).Select(x => (Guid?)x.SessionId).SingleOrDefaultAsync(ct) ?? throw ApiException.NotFound();
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var team = await db.SpeechTeams.SingleOrDefaultAsync(x => x.Id == teamId, ct) ?? throw ApiException.NotFound();
        var session = await LoadSession(team.SessionId, false, ct);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.TeamId == teamId, ct);
        if (!Manage)
        {
            RequireParticipant();
            if (team.LeaderId != Me) throw NotLeader();
            EnsureActive(session);
            if (entry is not null && entry.Status != SpeechStatus.Queued) throw ApiException.Conflict("队伍条目已开始或结束，不可解散");
        }
        if (entry is not null) await RemoveEntry(entry, ct);
        db.SpeechTeamMembers.RemoveRange(await db.SpeechTeamMembers.Where(x => x.TeamId == teamId).ToListAsync(ct));
        db.SpeechTeams.Remove(team); await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.team.disbanded", "SpeechTeam", team.Id.ToString(), new { team.SessionId, team.Name, team.LeaderId }, null), ct);
    }

    private async Task<string> NewJoinCode(CancellationToken ct)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var code = string.Create(6, 0, (span, _) => { for (var i = 0; i < span.Length; i++) span[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)]; });
            if (!await db.SpeechTeams.AnyAsync(x => x.JoinCode == code, ct)) return code;
        }
        throw new ApiException(503, "dependency.unavailable", "无法生成加入码，请重试");
    }

    // ---------------------------------------------------------------- admin: sessions

    public async Task<SpeechSessionView> CreateSession(SessionWriteRequest body, CancellationToken ct)
    {
        var policy = await settings.Get<SpeechSettings>("speech", ct);
        var session = new MeetingSession
        {
            Title = Input.Required(body.Title, "title", 200), Date = body.Date ?? throw ApiException.Validation("date", "必须提供日期"),
            Description = Input.Optional(body.Description, "description") ?? "", SlotMinutes = body.SlotMinutes ?? policy.DefaultSlotMinutes,
            AllowTeams = body.AllowTeams ?? policy.AllowTeams, MaxTeamSize = body.MaxTeamSize ?? policy.MaxTeamSize, SubmissionsOpen = body.SubmissionsOpen ?? true,
            Status = SpeechStatus.Draft, CreatedAt = clock.UtcNow
        };
        ValidateLimits(session);
        db.MeetingSessions.Add(session); await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.session.created", "MeetingSession", session.Id.ToString(), null, SessionView(session, 0, null)), ct);
        return SessionView(session, 0, null);
    }

    public async Task<SpeechSessionView> UpdateSession(Guid id, SessionWriteRequest body, HttpContext http, CancellationToken ct)
    {
        await using var _ = await locks.Acquire(LockKey(id), ct);
        var session = await LoadSession(id, true, ct);
        Input.Version(http, body.Version, session.Version);
        var before = SessionView(session, 0, null);
        if (body.Title is not null) session.Title = Input.Required(body.Title, "title", 200);
        if (body.Date is not null) session.Date = body.Date.Value;
        if (body.Description is not null) session.Description = Input.Optional(body.Description, "description") ?? "";
        if (body.SlotMinutes is not null) session.SlotMinutes = body.SlotMinutes.Value;
        if (body.AllowTeams is not null) session.AllowTeams = body.AllowTeams.Value;
        if (body.MaxTeamSize is not null) session.MaxTeamSize = body.MaxTeamSize.Value;
        if (body.SubmissionsOpen is not null) session.SubmissionsOpen = body.SubmissionsOpen.Value;
        ValidateLimits(session);
        if (body.MaxTeamSize is not null)
        {
            var largest = await db.SpeechTeamMembers.Where(x => x.SessionId == id).GroupBy(x => x.TeamId).Select(g => g.Count()).DefaultIfEmpty(0).MaxAsync(ct);
            if (largest > session.MaxTeamSize) throw ApiException.Conflict("已有队伍人数超过新的人数上限");
        }
        await db.SaveChangesAsync(ct);
        var (count, speaking) = await Counts(id, ct);
        await events.Publish(new("speech.session.updated", "MeetingSession", id.ToString(), before, SessionView(session, count, speaking)), ct);
        return SessionView(session, count, speaking);
    }

    public async Task DeleteSession(Guid id, HttpContext http, CancellationToken ct)
    {
        await using var _ = await locks.Acquire(LockKey(id), ct);
        var session = await LoadSession(id, true, ct);
        if (http.Request.Headers.IfMatch.Count > 0) Input.Version(http, null, session.Version);
        session.Deleted = true; await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.session.deleted", "MeetingSession", id.ToString(), SessionView(session, 0, null), null), ct);
    }

    public async Task<SpeechSessionView> SetStatus(Guid id, StatusRequest body, CancellationToken ct)
    {
        var target = body.Status ?? "";
        if (!Statuses.Contains(target)) throw ApiException.Validation("status", "无效的场次状态");
        await using var _ = await locks.Acquire(LockKey(id), ct);
        var session = await LoadSession(id, true, ct);
        if (!Transitions.Contains((session.Status, target))) throw ApiException.Conflict($"不允许从 {session.Status} 切换到 {target}");
        var before = session.Status;
        if (target == SpeechStatus.Closed)
        {
            var speaking = await db.SpeechEntries.SingleOrDefaultAsync(x => x.SessionId == id && x.Status == SpeechStatus.Speaking, ct);
            if (speaking is not null) { speaking.Status = SpeechStatus.Done; speaking.FinishedAt = clock.UtcNow; }
        }
        session.Status = target; await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.session.status", "MeetingSession", id.ToString(), new { status = before }, new { status = target }), ct);
        var (count, current) = await Counts(id, ct);
        return SessionView(session, count, current);
    }

    public async Task<SpeechSessionDetailView> SetOrder(Guid id, OrderRequest body, CancellationToken ct)
    {
        await using var _ = await locks.Acquire(LockKey(id), ct);
        await LoadSession(id, false, ct);
        var queued = await db.SpeechEntries.Where(x => x.SessionId == id && x.Status == SpeechStatus.Queued).ToListAsync(ct);
        var ids = body.EntryIds ?? [];
        if (ids.Length != ids.Distinct().Count() || ids.Length != queued.Count || ids.Except(queued.Select(x => x.Id)).Any())
            throw ApiException.Validation("entryIds", "须恰好包含本场次全部待演讲条目，且不得重复");
        var positions = queued.Select(x => x.Position).Order().ToArray();
        var byId = queued.ToDictionary(x => x.Id);
        for (var i = 0; i < ids.Length; i++) byId[ids[i]].Position = positions[i];
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.session.reordered", "MeetingSession", id.ToString(), null, new { entryIds = ids }), ct);
        return await GetSession(id, ct);
    }

    public Task<SpeechEntryView> Start(Guid entryId, CancellationToken ct) => Transition(entryId, "start", ct);
    public Task<SpeechEntryView> Finish(Guid entryId, CancellationToken ct) => Transition(entryId, "finish", ct);
    public Task<SpeechEntryView> Skip(Guid entryId, CancellationToken ct) => Transition(entryId, "skip", ct);

    private async Task<SpeechEntryView> Transition(Guid entryId, string action, CancellationToken ct)
    {
        var sessionId = await SessionIdOfEntry(entryId, ct);
        await using var _ = await locks.Acquire(LockKey(sessionId), ct);
        var entry = await db.SpeechEntries.SingleOrDefaultAsync(x => x.Id == entryId, ct) ?? throw ApiException.NotFound();
        var session = await LoadSession(entry.SessionId, true, ct);
        var before = entry.Status; var now = clock.UtcNow;
        switch (action)
        {
            case "start":
                if (session.Status is SpeechStatus.Draft or SpeechStatus.Closed) throw Closed();
                if (entry.Status is not (SpeechStatus.Queued or SpeechStatus.Skipped)) throw ApiException.Conflict("只有待演讲或已跳过的条目可以开始");
                if (await db.SpeechEntries.AnyAsync(x => x.SessionId == session.Id && x.Status == SpeechStatus.Speaking && x.Id != entry.Id, ct)) throw new ApiException(409, "speech.speaking_exists", "已有正在演讲的条目");
                entry.Status = SpeechStatus.Speaking; entry.StartedAt = now; entry.FinishedAt = null;
                if (session.Status == SpeechStatus.Open) session.Status = SpeechStatus.Running;
                break;
            case "finish":
                if (entry.Status != SpeechStatus.Speaking) throw ApiException.Conflict("只有正在演讲的条目可以完成");
                entry.Status = SpeechStatus.Done; entry.FinishedAt = now;
                break;
            default:
                if (entry.Status is not (SpeechStatus.Queued or SpeechStatus.Speaking)) throw ApiException.Conflict("只有待演讲或正在演讲的条目可以跳过");
                if (entry.Status == SpeechStatus.Speaking) entry.FinishedAt = now;
                entry.Status = SpeechStatus.Skipped;
                break;
        }
        await db.SaveChangesAsync(ct);
        await events.Publish(new("speech.entry." + (action == "start" ? "started" : action == "finish" ? "finished" : "skipped"), "SpeechEntry", entry.Id.ToString(), new { status = before }, new { status = entry.Status }), ct);
        return (await EntryViews([entry], ct))[0];
    }

    // ---------------------------------------------------------------- shared helpers

    public static string LockKey(Guid sessionId) => "speech:" + sessionId.ToString("N");
    private void RequireParticipant() { if (!current.Can("speech.participate")) throw ApiException.Forbidden(); }
    private static void EnsureOpenForSignup(MeetingSession session) { if (session.Status != SpeechStatus.Open || !session.SubmissionsOpen) throw Closed(); }
    private static void EnsureActive(MeetingSession session) { if (session.Status is not (SpeechStatus.Open or SpeechStatus.Running)) throw Closed(); }

    private static void ValidateLimits(MeetingSession session)
    {
        if (session.SlotMinutes is < 1 or > 60) throw ApiException.Validation("slotMinutes", "时长须为 1–60 分钟");
        if (session.MaxTeamSize is < 2 or > 20) throw ApiException.Validation("maxTeamSize", "队伍人数须为 2–20");
    }

    private async Task<Guid> SessionIdOfEntry(Guid entryId, CancellationToken ct) =>
        await db.SpeechEntries.AsNoTracking().Where(x => x.Id == entryId).Select(x => (Guid?)x.SessionId).SingleOrDefaultAsync(ct) ?? throw ApiException.NotFound();

    public async Task<MeetingSession> LoadSession(Guid id, bool track, CancellationToken ct)
    {
        var query = track ? db.MeetingSessions : db.MeetingSessions.AsNoTracking();
        var session = await query.SingleOrDefaultAsync(x => x.Id == id && !x.Deleted, ct) ?? throw ApiException.NotFound();
        if (session.Status == SpeechStatus.Draft && !Manage) throw ApiException.NotFound();
        return session;
    }

    private async Task<(int Count, Guid? Speaking)> Counts(Guid sessionId, CancellationToken ct) =>
        (await db.SpeechEntries.CountAsync(x => x.SessionId == sessionId, ct), await db.SpeechEntries.Where(x => x.SessionId == sessionId && x.Status == SpeechStatus.Speaking).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct));

    private static SpeechSessionView SessionView(MeetingSession x, int count, Guid? speaking) =>
        new(x.Id, x.Title, x.Date, x.Description, x.SlotMinutes, x.AllowTeams, x.MaxTeamSize, x.SubmissionsOpen, x.Status, count, speaking, x.Version, x.CreatedAt);

    public async Task<IReadOnlyList<SpeechEntryView>> EntryViews(IReadOnlyCollection<SpeechEntry> entries, CancellationToken ct)
    {
        var lookup = await Lookup.Build(db, entries, [], ct);
        return entries.Select(x => EntryView(x, lookup)).ToArray();
    }

    private async Task<SpeechTeamView> TeamViewOf(SpeechTeam team, CancellationToken ct)
    {
        var entry = await db.SpeechEntries.AsNoTracking().Where(x => x.TeamId == team.Id).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
        var lookup = await Lookup.Build(db, [], [team], ct);
        return TeamView(team, lookup, entry);
    }

    private SpeechEntryView EntryView(SpeechEntry entry, Lookup lookup)
    {
        var me = current.Id;
        TeamRef? team = null; var mine = entry.OwnerId == me;
        if (entry.TeamId is { } teamId && lookup.Teams.TryGetValue(teamId, out var t))
        {
            var members = lookup.MemberViews(t);
            team = new(t.Id, t.Name, members);
            mine |= members.Any(x => x.UserId == me);
        }
        var courseware = lookup.Coursewares.TryGetValue(entry.Id, out var cw) ? CoursewareMapper.View(cw, lookup.Person(cw.UploaderId)) : null;
        return new(entry.Id, entry.SessionId, entry.Position, entry.Topic, entry.Status, lookup.Person(entry.OwnerId), team, courseware, entry.StartedAt, entry.FinishedAt, mine, entry.Version);
    }

    private SpeechTeamView TeamView(SpeechTeam team, Lookup lookup, Guid? entryId)
    {
        var members = lookup.MemberViews(team); var mine = members.Any(x => x.UserId == current.Id);
        return new(team.Id, team.SessionId, team.Name, team.LeaderId, members, entryId, mine || Manage ? team.JoinCode : null, mine, team.Version);
    }

    private sealed class Lookup
    {
        public Dictionary<Guid, User> Users { get; init; } = [];
        public Dictionary<Guid, SpeechTeam> Teams { get; init; } = [];
        public ILookup<Guid, SpeechTeamMember> Members { get; init; } = Array.Empty<SpeechTeamMember>().ToLookup(x => x.TeamId);
        public Dictionary<Guid, Courseware> Coursewares { get; init; } = [];

        public static async Task<Lookup> Build(AppDbContext db, IReadOnlyCollection<SpeechEntry> entries, IReadOnlyCollection<SpeechTeam> extraTeams, CancellationToken ct)
        {
            var teamIds = entries.Where(x => x.TeamId is not null).Select(x => x.TeamId!.Value).Concat(extraTeams.Select(x => x.Id)).Distinct().ToList();
            var extraIds = extraTeams.Select(x => x.Id).ToList();
            var teams = extraTeams.Concat(await db.SpeechTeams.AsNoTracking().Where(x => teamIds.Contains(x.Id) && !extraIds.Contains(x.Id)).ToListAsync(ct)).GroupBy(x => x.Id).Select(g => g.First()).ToDictionary(x => x.Id);
            var members = (await db.SpeechTeamMembers.AsNoTracking().Where(x => teamIds.Contains(x.TeamId)).OrderBy(x => x.CreatedAt).ToListAsync(ct)).ToLookup(x => x.TeamId);
            var entryIds = entries.Select(x => x.Id).ToList();
            var coursewares = (await db.Coursewares.AsNoTracking().Where(x => entryIds.Contains(x.EntryId)).ToListAsync(ct)).ToDictionary(x => x.EntryId);
            var userIds = entries.Select(x => x.OwnerId).Concat(members.SelectMany(g => g).Select(x => x.UserId)).Concat(coursewares.Values.Select(x => x.UploaderId)).Distinct().ToList();
            var users = (await db.Users.AsNoTracking().Where(x => userIds.Contains(x.Id)).ToListAsync(ct)).ToDictionary(x => x.Id);
            return new() { Users = users, Teams = teams, Members = members, Coursewares = coursewares };
        }
        public PersonRef Person(Guid id) => Users.TryGetValue(id, out var user) ? new(user.Id, user.DisplayName, Avatar(user)) : new(id, "已删除用户", null);
        public IReadOnlyList<TeamMemberView> MemberViews(SpeechTeam team) =>
            Members[team.Id].Select(m => { var p = Person(m.UserId); return new TeamMemberView(m.UserId, p.DisplayName, p.AvatarUrl, m.UserId == team.LeaderId); }).OrderByDescending(x => x.IsLeader).ToArray();
        private static string? Avatar(User user) => user.AvatarId is { } id ? $"/api/v1/media/{id}" : null;
    }
}

public static class CoursewareMapper
{
    public static string PreviewMode(Courseware item) => item.Kind switch
    {
        "pdf" => "pdf",
        "web" => "web",
        "pptx" => item.ConversionStatus == "ready" ? "pdf" : "pptx",
        "ppt" => item.ConversionStatus == "ready" ? "pdf" : "none",
        _ => "none"
    };
    public static CoursewareView View(Courseware item, PersonRef uploader) => new(item.Id, item.EntryId, item.Kind, item.OriginalName, item.Size, item.ConversionStatus, PreviewMode(item), item.CreatedAt, uploader);
}
