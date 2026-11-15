using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Chat;

public sealed record SendMessage(Guid ClientId, string? Body);
public sealed record MessageView(long Id, Guid SenderId, string SenderName, string Body, DateTimeOffset SentAt, bool Deleted);
public sealed record ChatPage(IReadOnlyList<MessageView> Items, long? Before);

public sealed class ChatModule : IPluginModule
{
    private const string Id = "chat";
    public string Name => "Chat";
    public PluginManifest Manifest => new(Id, "Class chat", "Class group conversation", "1.0.0", WorkspacePath: Id, Permission: "chat.read", Icon: "chat");
    public IEnumerable<PermissionDefinition> DeclarePermissions() =>
        [new("chat.read", Name, "查看班级群聊"), new("chat.send", Name, "发送和撤回自己的消息"), new("chat.moderate", Name, "删除班级群聊消息")];

    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IManagedPlugin>(new ManagedPlugin(Id, true));
        services.AddPluginDatabase<ChatDatabase>(options => new(options), ChatDatabase.Schema);
        services.AddScoped<ChatService>();
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var routes = endpoints.MapGroup("/api/v1/plugins/chat/api/messages").RequireAuthorization("chat.read").WithTags("Chat");
        routes.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var services = http.RequestServices;
            if (!await services.GetRequiredService<PluginStateStore>().IsEnabled(Id, http.RequestAborted)) throw ApiException.NotFound();
            await services.GetRequiredService<PluginDatabase.Schema<ChatDatabase>>().Ensure(services.GetRequiredService<ChatDatabase>(), http.RequestAborted);
            return await next(context);
        });
        routes.MapGet("", (long? before, int? limit, [FromServices] ChatService chat, CancellationToken ct) => chat.List(before, limit ?? 50, ct));
        routes.MapPost("", ([FromBody] SendMessage input, [FromServices] ChatService chat, CancellationToken ct) => chat.Send(input, ct)).RequireAuthorization("chat.send");
        routes.MapDelete("/{id:long}", async (long id, [FromServices] ChatService chat, CancellationToken ct) =>
        {
            await chat.Delete(id, ct);
            return Results.NoContent();
        });
    }
}

public sealed class ChatService(ChatDatabase chat, AppDbContext users, ICurrentUser current, IClock clock, IRateLimitStore limits, IEventBus events)
{
    private Guid Me => current.Id ?? throw ApiException.Forbidden();
    private static MessageView View(ChatMessage item) => new(item.Id, item.SenderId, item.SenderName, item.Body, DateTimeOffset.FromUnixTimeMilliseconds(item.SentAt), item.Deleted);

    public async Task<ChatPage> List(long? before, int limit, CancellationToken ct)
    {
        if (before is <= 0 || limit is < 1 or > 100) throw ApiException.Validation("limit", "无效的聊天记录分页参数");
        var query = chat.Messages.AsNoTracking();
        if (before is long cursor) query = query.Where(x => x.Id < cursor);
        var entries = await query.OrderByDescending(x => x.Id).Take(limit + 1).ToListAsync(ct);
        var page = entries.Take(limit).Reverse().Select(View).ToArray();
        return new(page, entries.Count > limit ? page[0].Id : null);
    }

    public async Task<MessageView> Send(SendMessage input, CancellationToken ct)
    {
        if (input.ClientId == Guid.Empty) throw ApiException.Validation("clientId", "须提供消息编号");
        var body = Input.Required(input.Body, "body", 2000);
        var sender = Me;
        var previous = chat.Messages.AsNoTracking().Where(x => x.SenderId == sender && x.ClientId == input.ClientId);
        var existing = await previous.SingleOrDefaultAsync(ct);
        if (existing is not null) return View(existing);
        if (!await limits.Take("chat.send:" + sender, 30, TimeSpan.FromMinutes(1), ct)) throw new ApiException(429, "rate.limited", "发送频率过高");
        var name = await users.Users.AsNoTracking().Where(x => x.Id == sender && !x.Disabled && !x.Deleted).Select(x => x.DisplayName).SingleOrDefaultAsync(ct) ?? throw ApiException.Forbidden();
        var item = new ChatMessage { ClientId = input.ClientId, SenderId = sender, SenderName = name, SentAt = clock.UtcNow.ToUnixTimeMilliseconds(), Body = body };
        chat.Messages.Add(item);
        try { await chat.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            existing = await previous.SingleOrDefaultAsync(ct);
            if (existing is not null) return View(existing);
            throw;
        }
        return View(item);
    }

    public async Task Delete(long id, CancellationToken ct)
    {
        var sender = await chat.Messages.Where(x => x.Id == id).Select(x => (Guid?)x.SenderId).SingleOrDefaultAsync(ct) ?? throw ApiException.NotFound();
        if (!(sender == Me && current.Can("chat.send")) && !current.Can("chat.moderate")) throw ApiException.Forbidden();
        var updated = await chat.Messages.Where(x => x.Id == id && !x.Deleted).ExecuteUpdateAsync(update => update.SetProperty(x => x.Body, "").SetProperty(x => x.Deleted, true), ct);
        if (updated > 0 && sender != Me) await events.Publish(new("chat.message.removed", "ChatMessage", id.ToString(System.Globalization.CultureInfo.InvariantCulture), new { sender }, null), ct);
    }
}
