using System.Security.Cryptography;
using System.Text.Json;
using Classight.SharedKernel;
using Microsoft.EntityFrameworkCore;

namespace Classight.Api;

public sealed class ApiErrors(RequestDelegate next, ILogger<ApiErrors> logger)
{
    public async Task Invoke(HttpContext context)
    {
        try { await next(context); }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (context.Response.HasStarted) throw;
            context.Response.Headers.Remove("Set-Cookie");
            var (status, code, message, errors) = ex switch
            {
                ApiException api => (api.Status, api.Code, api.Message, api.Errors),
                DbUpdateConcurrencyException => (409, "resource.version_mismatch", "资源已被修改，请重新加载", null),
                DbUpdateException => (409, "resource.conflict", "数据约束冲突", null),
                BadHttpRequestException or JsonException or InvalidDataException => (400, "validation.failed", "请求格式无效", null),
                System.Data.Common.DbException or StackExchange.Redis.RedisException or MongoDB.Driver.MongoException => (503, "dependency.unavailable", "依赖服务暂时不可用", null),
                _ => (500, "server.error", "服务器内部错误", null)
            };
            if (code == "setup.required") logger.LogDebug("Setup gate blocked {Method} {Path} until first-run setup completes", context.Request.Method, context.Request.Path);
            else if (status >= 500) logger.LogError(ex, "Request failed: {TraceId}", context.TraceIdentifier);
            await Write(context, status, code, message, errors);
        }
    }
    public static Task Write(HttpContext context, int status, string code, string message, IDictionary<string, string[]>? errors = null)
    {
        context.Response.Headers.CacheControl = "no-store";
        return Results.Problem(statusCode: status, title: message, type: "about:blank", instance: context.Request.Path, extensions: new Dictionary<string, object?> { ["code"] = code, ["traceId"] = context.TraceIdentifier, ["errors"] = errors ?? new Dictionary<string, string[]>() }).ExecuteAsync(context);
    }
}
public sealed class PublicCacheMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext http)
    {
        var path = http.Request.Path;
        var eligible = HttpMethods.IsGet(http.Request.Method) && (path == "/api/v1/site/public" || path.StartsWithSegments("/api/v1/class"));
        if (!eligible) { await next(http); return; }
        var original = http.Response.Body;
        await using var buffer = new MemoryStream(); http.Response.Body = buffer;
        try
        {
            await next(http);
            http.Response.Body = original;
            if (http.Response.StatusCode == 200)
            {
                var tag = ((char)34) + Convert.ToHexString(SHA256.HashData(buffer.ToArray())) + ((char)34);
                http.Response.Headers.ETag = tag;
                http.Response.Headers.CacheControl = http.User.Identity?.IsAuthenticated == true ? "private,no-cache" : "public,max-age=0,must-revalidate";
                http.Response.Headers.Vary = "Authorization";
                if (http.Request.Headers.IfNoneMatch.ToString().Split(',').Any(x => x.Trim() == tag || x.Trim() == "*")) { http.Response.StatusCode = 304; http.Response.ContentLength = null; return; }
            }
            buffer.Position = 0; await buffer.CopyToAsync(original, http.RequestAborted);
        }
        finally { http.Response.Body = original; }
    }
}
