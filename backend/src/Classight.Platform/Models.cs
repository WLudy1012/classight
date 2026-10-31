namespace Classight.Platform;

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool Deleted { get; set; }
}
public sealed class User : Entity
{
    public string Username { get; set; } = "";
    public string NormalizedUsername { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string PasswordHash { get; set; } = "";
    public string Bio { get; set; } = "";
    public Guid? AvatarId { get; set; }
    public bool Disabled { get; set; }
    public int FailedAttempts { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    public List<UserRole> UserRoles { get; set; } = [];
}
public sealed class Role : Entity
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string[] Permissions { get; set; } = [];
    public bool BuiltIn { get; set; }
}
public sealed class UserRole
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public Guid RoleId { get; set; }
    public Role Role { get; set; } = null!;
}
public sealed class Session : Entity
{
    public Guid UserId { get; set; }
    public string RefreshHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public bool Revoked { get; set; }
    public string Device { get; set; } = "";
    public string Ip { get; set; } = "";
}
public sealed class UsedRefreshToken : Entity
{
    public Guid SessionId { get; set; }
    public string Hash { get; set; } = "";
}
public sealed class Invite : Entity
{
    public string Code { get; set; } = "";
    public Guid RoleId { get; set; }
    public int MaxUses { get; set; } = 1;
    public int UsedCount { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
public sealed class ClassProfile : Entity
{
    public string Name { get; set; } = "Classight";
    public string? NameEn { get; set; }
    public string Motto { get; set; } = "";
    public string Intro { get; set; } = "";
    public DateOnly FoundedOn { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);
    public string? CoverUrl { get; set; }
}
public sealed class Member : Entity
{
    public string DisplayName { get; set; } = "";
    public string? AvatarUrl { get; set; }
    public string? Title { get; set; }
    public string Role { get; set; } = "student";
    public DateOnly? JoinedOn { get; set; }
    public string? Intro { get; set; }
    public Guid? UserId { get; set; }
}
public sealed class TimelineEvent : Entity
{
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Body { get; set; } = "";
    public DateOnly OccurredOn { get; set; }
    public string? CoverUrl { get; set; }
    public string[] Tags { get; set; } = [];
    public Guid[] Media { get; set; } = [];
}
public sealed class MediaAsset : Entity
{
    public Guid OwnerId { get; set; }
    public string StorageKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public bool Public { get; set; }
}
public sealed class Setting : Entity
{
    public string Group { get; set; } = "";
    public string Json { get; set; } = "{}";
}
public sealed class AuditEntry : Entity
{
    public Guid? Actor { get; set; }
    public string Action { get; set; } = "";
    public string ResourceType { get; set; } = "";
    public string ResourceId { get; set; } = "";
    public string? Before { get; set; }
    public string? After { get; set; }
    public string TraceId { get; set; } = "";
}
public sealed class ActivityEntry : Entity
{
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "{}";
}
public sealed class Notification : Entity
{
    public Guid UserId { get; set; }
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTimeOffset? ReadAt { get; set; }
}
public sealed class SiteSettings
{
    public string ClassName { get; set; } = "Classight";
    public string? ClassNameEn { get; set; }
    public string Slogan { get; set; } = "一起记录我们的时光";
}
public sealed class AppearanceSettings
{
    public string ParticleQualityDefault { get; set; } = "medium";
    public string ParticleColor { get; set; } = "#80cbc4";
    public string AccentColor { get; set; } = "#ffffff";
    public string? FontSubsetUrl { get; set; }
}
public sealed class SecuritySettings
{
    public string RegistrationMode { get; set; } = "invite";
    public int MinPasswordLength { get; set; } = 12;
    public int SessionHours { get; set; } = 720;
    public bool ClassInfoPublic { get; set; } = true;
    [System.Text.Json.Serialization.JsonIgnore]
    public int AccessTokenMinutes { get; set; } = 15;
}
public sealed class StorageSettings
{
    public string Provider { get; set; } = "local";
    public int MaxUploadMb { get; set; } = 10;
    public string[] AllowedTypes { get; set; } = ["image/png", "image/jpeg", "image/webp", "image/gif"];
}
public sealed class SpeechSettings
{
    public int DefaultSlotMinutes { get; set; } = 5;
    public bool AllowTeams { get; set; } = true;
    public int MaxTeamSize { get; set; } = 4;
    public int MaxCoursewareMb { get; set; } = 50;
}
public static class SpeechStatus
{
    public const string Draft = "draft", Open = "open", Running = "running", Closed = "closed";
    public const string Queued = "queued", Speaking = "speaking", Done = "done", Skipped = "skipped";
}
public sealed class MeetingSession : Entity
{
    public string Title { get; set; } = "";
    public DateOnly Date { get; set; }
    public string Description { get; set; } = "";
    public int SlotMinutes { get; set; } = 5;
    public bool AllowTeams { get; set; } = true;
    public int MaxTeamSize { get; set; } = 4;
    public bool SubmissionsOpen { get; set; } = true;
    public string Status { get; set; } = SpeechStatus.Draft;
}
public sealed class SpeechTeam : Entity
{
    public Guid SessionId { get; set; }
    public string Name { get; set; } = "";
    public Guid LeaderId { get; set; }
    public string JoinCode { get; set; } = "";
}
public sealed class SpeechTeamMember : Entity
{
    public Guid SessionId { get; set; }
    public Guid TeamId { get; set; }
    public Guid UserId { get; set; }
}
public sealed class SpeechEntry : Entity
{
    public Guid SessionId { get; set; }
    public int Position { get; set; }
    public Guid OwnerId { get; set; }
    public Guid? TeamId { get; set; }
    public string Topic { get; set; } = "";
    public string Status { get; set; } = SpeechStatus.Queued;
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
}
public sealed class Courseware : Entity
{
    public Guid EntryId { get; set; }
    public Guid UploaderId { get; set; }
    public string Kind { get; set; } = "pdf";
    public string OriginalName { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public long Size { get; set; }
    public string ConversionStatus { get; set; } = "none";
    public string? PdfKey { get; set; }
    public string? WebEntry { get; set; }
}
