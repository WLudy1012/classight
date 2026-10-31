using System.Collections.Concurrent;
using System.Text.Json;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Hybrid;
using Microsoft.Extensions.Configuration;
using MongoDB.Driver;
using StackExchange.Redis;

namespace Classight.Platform;

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static string Serialize(object? value) => JsonSerializer.Serialize(value, Options);
}
public interface ICacheService
{
    ValueTask<T> Get<T>(string key, Func<CancellationToken, ValueTask<T>> factory, CancellationToken ct);
    ValueTask Clear(CancellationToken ct);
}
public sealed class CacheService(HybridCache cache) : ICacheService
{
    public ValueTask<T> Get<T>(string key, Func<CancellationToken, ValueTask<T>> factory, CancellationToken ct) => cache.GetOrCreateAsync(key, factory, tags: ["classight"], cancellationToken: ct);
    public ValueTask Clear(CancellationToken ct) => cache.RemoveByTagAsync("classight", ct);
}
public interface IDistributedLock { ValueTask<IAsyncDisposable> Acquire(string key, CancellationToken ct); }
public sealed class LocalLock : IDistributedLock
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> locks = new();
    public async ValueTask<IAsyncDisposable> Acquire(string key, CancellationToken ct)
    {
        var gate = locks.GetOrAdd(key, _ => new(1, 1));
        await gate.WaitAsync(ct);
        return new Lease(gate);
    }
    private sealed class Lease(SemaphoreSlim gate) : IAsyncDisposable { public ValueTask DisposeAsync() { gate.Release(); return ValueTask.CompletedTask; } }
}
public sealed class RedisLock(IConnectionMultiplexer redis) : IDistributedLock
{
    public async ValueTask<IAsyncDisposable> Acquire(string key, CancellationToken ct)
    {
        var token = Guid.NewGuid().ToString("N"); var db = redis.GetDatabase();
        var name = "classight:lock:" + key;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (!await db.StringSetAsync(name, token, TimeSpan.FromSeconds(30), When.NotExists))
        {
            if (DateTimeOffset.UtcNow >= deadline) throw new ApiException(503, "dependency.unavailable", "锁等待超时");
            await Task.Delay(50, ct);
        }
        return new Lease(db, name, token);
    }
    private sealed class Lease(IDatabase db, string key, string token) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync() => await db.ScriptEvaluateAsync("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", [key], [token]);
    }
}
public interface IRateLimitStore { Task<bool> Take(string key, int limit, TimeSpan window, CancellationToken ct); }
public sealed class LocalRateLimitStore(IClock clock) : IRateLimitStore
{
    private readonly ConcurrentDictionary<string, (long Window, int Count)> counts = new();
    private long calls;
    public Task<bool> Take(string key, int limit, TimeSpan window, CancellationToken ct)
    {
        var bucket = clock.UtcNow.ToUnixTimeSeconds() / (long)window.TotalSeconds;
        var value = counts.AddOrUpdate(key, (bucket, 1), (_, old) => old.Window == bucket ? (bucket, old.Count + 1) : (bucket, 1));
        if (Interlocked.Increment(ref calls) % 1024 == 0)
            foreach (var item in counts.Where(x => x.Value.Window < bucket - 2)) counts.TryRemove(item.Key, out _);
        return Task.FromResult(value.Count <= limit);
    }
}
public sealed class RedisRateLimitStore(IConnectionMultiplexer redis, IClock clock) : IRateLimitStore
{
    public async Task<bool> Take(string key, int limit, TimeSpan window, CancellationToken ct)
    {
        var name = "classight:rate:" + key + ":" + clock.UtcNow.ToUnixTimeSeconds() / (long)window.TotalSeconds;
        var count = (long)await redis.GetDatabase().ScriptEvaluateAsync("local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],ARGV[1]); end; return n", [name], [(long)window.TotalSeconds + 1]);
        return count <= limit;
    }
}
public record DomainChange(string Action, string ResourceType, string ResourceId, object? Before, object? After, object? Event = null);
public interface IEventBus { Task Publish(DomainChange change, CancellationToken ct); }
public interface IEventHandler { Task Handle(DomainChange change, CancellationToken ct); }
public sealed class EventBus(IEnumerable<IEventHandler> handlers) : IEventBus
{
    public async Task Publish(DomainChange change, CancellationToken ct) { foreach (var handler in handlers) await handler.Handle(change, ct); }
}
public interface IAuditStore
{
    Task Append(AuditEntry entry, CancellationToken ct);
    Task<Page<AuditEntry>> List(HttpRequest request, CancellationToken ct);
    Task<AuditEntry?> Get(Guid id, CancellationToken ct);
}
public sealed class RelationalAuditStore(AppDbContext db) : IAuditStore
{
    public async Task Append(AuditEntry entry, CancellationToken ct) { db.AuditLogs.Add(entry); await db.SaveChangesAsync(ct); }
    public Task<AuditEntry?> Get(Guid id, CancellationToken ct) => db.AuditLogs.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
    public async Task<Page<AuditEntry>> List(HttpRequest request, CancellationToken ct)
    {
        var query = AuditQuery.Filter(db.AuditLogs.AsNoTracking(), request);
        var (page, size) = Input.Paging(request);
        return new(await query.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * size).Take(size).ToListAsync(ct), await query.CountAsync(ct), page, size);
    }
}
public static class AuditQuery
{
    public static IQueryable<AuditEntry> Filter(IQueryable<AuditEntry> query, HttpRequest request)
    {
        if (request.Query.TryGetValue("actor", out var actor))
        {
            if (!Guid.TryParse(actor, out var id)) throw ApiException.Validation("actor", "无效 ID");
            query = query.Where(x => x.Actor == id);
        }
        if (request.Query.TryGetValue("action", out var action)) query = query.Where(x => x.Action == action.ToString());
        if (request.Query.TryGetValue("resourceType", out var resource)) query = query.Where(x => x.ResourceType == resource.ToString());
        foreach (var key in new[] { "from", "to" })
        {
            if (!request.Query.TryGetValue(key, out var text)) continue;
            if (!DateTimeOffset.TryParse(text, out var date)) throw ApiException.Validation(key, "无效时间");
            date = date.ToUniversalTime();
            query = key == "from" ? query.Where(x => x.CreatedAt >= date) : query.Where(x => x.CreatedAt <= date);
        }
        return query;
    }
}
public sealed class MongoAuditStore(IMongoDatabase mongo) : IAuditStore
{
    private IMongoCollection<AuditEntry> Entries => mongo.GetCollection<AuditEntry>("auditLogs");
    public Task Append(AuditEntry entry, CancellationToken ct) => Entries.InsertOneAsync(entry, cancellationToken: ct);
    public async Task<AuditEntry?> Get(Guid id, CancellationToken ct) => await Entries.Find(x => x.Id == id).FirstOrDefaultAsync(ct);
    public async Task<Page<AuditEntry>> List(HttpRequest request, CancellationToken ct)
    {
        var query = AuditQuery.Filter(Entries.AsQueryable(), request); var (page, size) = Input.Paging(request);
        var count = await MongoDB.Driver.Linq.MongoQueryable.CountAsync(query, ct);
        var items = await MongoDB.Driver.Linq.MongoQueryable.ToListAsync(query.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * size).Take(size), ct);
        return new(items, count, page, size);
    }
}
public interface IActivityStore { Task Append(ActivityEntry entry, CancellationToken ct); }
public sealed class RelationalActivityStore(AppDbContext db) : IActivityStore
{
    public async Task Append(ActivityEntry entry, CancellationToken ct) { db.Activities.Add(entry); await db.SaveChangesAsync(ct); }
}
public sealed class MongoActivityStore(IMongoDatabase mongo) : IActivityStore
{
    public Task Append(ActivityEntry entry, CancellationToken ct) => mongo.GetCollection<ActivityEntry>("activities").InsertOneAsync(entry, cancellationToken: ct);
}
public sealed class AuditEventHandler(IAuditStore audits, ICurrentUser user, IHttpContextAccessor http, IClock clock) : IEventHandler
{
    public Task Handle(DomainChange change, CancellationToken ct) => audits.Append(new AuditEntry { Actor = user.Id, Action = change.Action, ResourceType = change.ResourceType, ResourceId = change.ResourceId, Before = change.Before is null ? null : JsonDefaults.Serialize(change.Before), After = change.After is null ? null : JsonDefaults.Serialize(change.After), TraceId = http.HttpContext?.TraceIdentifier ?? "startup", CreatedAt = clock.UtcNow }, ct);
}
public sealed class CacheEventHandler(ICacheService cache) : IEventHandler
{
    public async Task Handle(DomainChange change, CancellationToken ct) => await cache.Clear(ct);
}
public interface IEmailSender { bool Enabled { get; } Task Send(string to, string subject, string body, CancellationToken ct); }
public sealed class NoopEmailSender : IEmailSender
{
    public bool Enabled => false;
    public Task Send(string to, string subject, string body, CancellationToken ct) => throw new InvalidOperationException("邮件未配置");
}
public interface INotificationDispatcher { Task Send(Notification notification, CancellationToken ct); }
public sealed class NotificationDispatcher(AppDbContext db) : INotificationDispatcher
{
    public async Task Send(Notification notification, CancellationToken ct) { db.Notifications.Add(notification); await db.SaveChangesAsync(ct); }
}
public interface IMediaStorage
{
    Task Write(string key, Stream data, CancellationToken ct);
    Task<Stream> Read(string key, CancellationToken ct);
    Task Delete(string key, CancellationToken ct);
}
public sealed class LocalMediaStorage(IConfiguration config) : IMediaStorage
{
    private readonly string root = Path.GetFullPath(config["Storage:LocalPath"] ?? "data/media");
    private string Resolve(string key)
    {
        if (!Guid.TryParseExact(key, "N", out _)) throw new InvalidOperationException("Invalid storage key");
        return Path.Combine(root, key);
    }
    public async Task Write(string key, Stream data, CancellationToken ct)
    {
        Directory.CreateDirectory(root);
        var path = Resolve(key);
        try { await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write); await data.CopyToAsync(file, ct); }
        catch { File.Delete(path); throw; }
    }
    public Task<Stream> Read(string key, CancellationToken ct) => Task.FromResult<Stream>(File.OpenRead(Resolve(key)));
    public Task Delete(string key, CancellationToken ct) { File.Delete(Resolve(key)); return Task.CompletedTask; }
}
