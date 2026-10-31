namespace Classight.Contracts;

public interface IMemberPermissionVerifier
{
    Task<bool> HasPermission(string permission, CancellationToken ct);
    Task RequirePermission(string permission, CancellationToken ct);
}
