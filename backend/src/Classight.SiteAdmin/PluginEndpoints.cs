using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Classight.SiteAdmin;

public static class PluginEndpoints
{
    public sealed record Change(bool Enabled);
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/plugins", async (PluginStateStore store, CancellationToken ct) =>
        {
            return await store.ListStates(ct);
        });
        endpoints.MapGet("/api/v1/admin/plugins", async (PluginStateStore store, CancellationToken ct) =>
        {
            var states = await store.ListStates(ct);
            return store.Plugins.Select(plugin => new { id = plugin.Id, enabled = states[plugin.Id], dependencies = plugin.Dependencies }).ToArray();
        }).RequireAuthorization("site.settings.read");
        endpoints.MapPut("/api/v1/admin/plugins/{id}", async (string id, Change change, PluginStateStore store, IEventBus events, CancellationToken ct) =>
        {
            var plugin = store.Plugins.SingleOrDefault(x => x.Id == id) ?? throw ApiException.NotFound();
            if (change.Enabled && !await store.IsReady(plugin, ct)) throw ApiException.Validation("config", "请先完整配置插件");
            if (change.Enabled)
                foreach (var dependency in plugin.Dependencies)
                    if (!await store.IsEnabled(dependency, ct)) throw ApiException.Validation("dependencies", $"请先启用依赖插件 {dependency}");
            if (!change.Enabled)
                foreach (var dependent in store.Plugins.Where(x => x.Dependencies.Contains(id)))
                    if (await store.IsEnabled(dependent.Id, ct)) throw ApiException.Validation("dependencies", $"请先停用依赖此插件的 {dependent.Id}");
            var before = await store.IsEnabled(id, ct);
            await store.SetEnabled(id, change.Enabled, ct);
            await events.Publish(new("plugin.updated", "Plugin", id, new { enabled = before }, new { enabled = change.Enabled }), ct);
            return new { id, enabled = change.Enabled };
        }).RequireAuthorization("site.settings.write");
    }

}
