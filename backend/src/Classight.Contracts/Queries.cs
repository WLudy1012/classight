namespace Classight.Contracts;

public record UserSummary(Guid Id, string Username, string DisplayName, string? AvatarUrl);
public record LinkedMember(Guid Id, string DisplayName, string? AvatarUrl, string? Title);
public interface IIdentityQueries { Task<UserSummary?> GetUser(Guid id, CancellationToken ct); }
public interface IClassProfileQueries { Task<LinkedMember?> GetLinkedMember(Guid userId, CancellationToken ct); }
public interface ISiteSettingsReader
{
    Task<T> Get<T>(string group, CancellationToken ct) where T : new();
}
public record UserRegistered(Guid UserId);
public record UserDisabled(Guid UserId);
public record UserRolesChanged(Guid UserId);
public record ClassProfileUpdated(Guid ProfileId);
public record MemberLinked(Guid MemberId, Guid? UserId);
public record SettingChanged(string Group);
