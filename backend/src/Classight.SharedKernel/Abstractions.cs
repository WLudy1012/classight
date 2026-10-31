using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.SharedKernel;

public interface IModule
{
    string Name { get; }
    void AddServices(IServiceCollection services, IConfiguration configuration);
    void MapEndpoints(IEndpointRouteBuilder endpoints);
    IEnumerable<PermissionDefinition> DeclarePermissions();
}

public record PermissionDefinition(string Code, string Module, string Description);
public interface IPermissionCatalog { IReadOnlyList<PermissionDefinition> All { get; } }
public sealed class PermissionCatalog(IEnumerable<IModule> modules) : IPermissionCatalog
{
    public IReadOnlyList<PermissionDefinition> All { get; } = modules.SelectMany(x => x.DeclarePermissions()).ToArray();
}
public interface IClock { DateTimeOffset UtcNow { get; } }
public sealed class SystemClock : IClock { public DateTimeOffset UtcNow => DateTimeOffset.UtcNow; }
public interface ICurrentUser
{
    Guid? Id { get; }
    Guid? SessionId { get; }
    bool Can(string permission);
}
public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? Id => Guid.TryParse(accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? accessor.HttpContext?.User.FindFirstValue("sub"), out var id) ? id : null;
    public Guid? SessionId => Guid.TryParse(accessor.HttpContext?.User.FindFirstValue("sid"), out var id) ? id : null;
    public bool Can(string permission) => accessor.HttpContext?.User.HasClaim("permission", permission) == true;
}
public class ApiException(int status, string code, string message, IDictionary<string, string[]>? errors = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public IDictionary<string, string[]> Errors { get; } = errors ?? new Dictionary<string, string[]>();
    public static ApiException NotFound() => new(404, "resource.not_found", "资源不存在");
    public static ApiException Forbidden() => new(403, "permission.denied", "没有权限执行此操作");
    public static ApiException Validation(string field, string message) => new(400, "validation.failed", message, new Dictionary<string, string[]> { [field] = [message] });
    public static ApiException Conflict(string message = "资源发生冲突") => new(409, "resource.conflict", message);
}
public record Page<T>(IReadOnlyList<T> Items, int Total, int PageNumber, int PageSize)
{
    [System.Text.Json.Serialization.JsonPropertyName("page")]
    public int Number => PageNumber;
    [System.Text.Json.Serialization.JsonIgnore]
    public int PageNumber { get; init; } = PageNumber;
}
public static class Input
{
    public static string Required(string? value, string field, int max = 200)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length > max) throw ApiException.Validation(field, $"不能为空且长度不得超过 {max}");
        return value.Trim();
    }
    public static string? Optional(string? value, string field, int max = 2000)
    {
        if (value?.Length > max) throw ApiException.Validation(field, $"长度不得超过 {max}");
        return value?.Trim();
    }
    public static string? Email(string? value)
    {
        value = Optional(value, "email", 254);
        if (string.IsNullOrEmpty(value)) return null;
        if (!System.Net.Mail.MailAddress.TryCreate(value, out var parsed) || parsed.Address != value) throw ApiException.Validation("email", "邮箱格式错误");
        return value;
    }
    public static string? Url(string? value, string field)
    {
        value = Optional(value, field, 2048);
        if (string.IsNullOrEmpty(value)) return null;
        if (value.StartsWith('/') && !value.StartsWith("//")) return value;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https") return value;
        throw ApiException.Validation(field, "须为站内路径或 HTTPS 地址");
    }
    public static void Version(HttpContext context, long? supplied, long current)
    {
        var match = context.Request.Headers.IfMatch.ToString();
        if (!string.IsNullOrEmpty(match))
        {
            if (!long.TryParse(match.Trim('"'), out var parsed)) throw ApiException.Validation("If-Match", "版本格式错误");
            supplied = parsed;
        }
        if (supplied is null) throw ApiException.Validation("version", "必须提供 version 或 If-Match");
        if (supplied != current) throw new ApiException(409, "resource.version_mismatch", "资源已被修改，请重新加载");
    }
    public static (int Page, int Size) Paging(HttpRequest request)
    {
        int Parse(string key, int fallback) => !request.Query.ContainsKey(key) ? fallback : int.TryParse(request.Query[key], out var n) ? n : throw ApiException.Validation(key, "必须为整数");
        var page = Parse("page", 1); var size = Parse("pageSize", 20);
        if (page < 1 || page > 1_000_000 || size is < 1 or > 100) throw ApiException.Validation("page", "page 必须大于零，pageSize 必须为 1–100");
        return (page, size);
    }
}
