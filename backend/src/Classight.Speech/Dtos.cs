using System.Text.Json.Serialization;

namespace Classight.Speech;

public record PersonRef(Guid Id, string DisplayName, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl);
public record TeamMemberView(Guid UserId, string DisplayName, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl, bool IsLeader);
public record TeamRef(Guid Id, string Name, IReadOnlyList<TeamMemberView> Members);
public record CoursewareView(Guid Id, Guid EntryId, string Kind, string OriginalName, long Size, string Conversion, string PreviewMode, DateTimeOffset UploadedAt, PersonRef Uploader);
public record PreviewTicket(string Mode, string Url, DateTimeOffset ExpiresAt, string FileName);
public record SpeechEntryView(
    Guid Id, Guid SessionId, int Position, string Topic, string Status, PersonRef Owner,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TeamRef? Team,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CoursewareView? Courseware,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? StartedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? FinishedAt,
    bool Mine, long Version);
public record SpeechTeamView(
    Guid Id, Guid SessionId, string Name, Guid LeaderId, IReadOnlyList<TeamMemberView> Members,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? EntryId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? JoinCode,
    bool Mine, long Version);
public record SpeechSessionView(
    Guid Id, string Title, DateOnly Date, string Description, int SlotMinutes, bool AllowTeams, int MaxTeamSize, bool SubmissionsOpen, string Status, int EntryCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? CurrentEntryId,
    long Version, DateTimeOffset CreatedAt);
public record SpeechSessionDetailView(
    Guid Id, string Title, DateOnly Date, string Description, int SlotMinutes, bool AllowTeams, int MaxTeamSize, bool SubmissionsOpen, string Status, int EntryCount,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? CurrentEntryId,
    long Version, DateTimeOffset CreatedAt,
    IReadOnlyList<SpeechEntryView> Entries, IReadOnlyList<SpeechTeamView> Teams,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? MyEntryId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? MyTeamId);
public record CapabilitiesView(bool PptConverter, int MaxCoursewareMb, string[] AllowedKinds, CapabilityDefaults Defaults);
public record CapabilityDefaults(int SlotMinutes, bool AllowTeams, int MaxTeamSize);

public record EntryCreateRequest(string Topic, Guid? TeamId);
public record EntryPatchRequest(string Topic, long? Version);
public record TeamCreateRequest(string Name);
public record TeamJoinRequest(string Code);
public record SessionWriteRequest(string? Title, DateOnly? Date, string? Description, int? SlotMinutes, bool? AllowTeams, int? MaxTeamSize, bool? SubmissionsOpen, long? Version);
public record StatusRequest(string Status);
public record OrderRequest(Guid[] EntryIds);
public record AdminEntryCreateRequest(string Topic, Guid OwnerId, Guid? TeamId);
