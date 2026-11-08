using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Classight.SharedKernel;

namespace Classight.Platform;

public sealed class PluginStateStore(AppDbContext db, IEnumerable<IManagedPlugin> plugins, IServiceProvider services)
{
    public IReadOnlyList<IManagedPlugin> Plugins { get; } = plugins.ToArray();
    public Task<bool> IsReady(IManagedPlugin plugin, CancellationToken ct) => plugin.IsReady(services, ct);

    public async Task<IReadOnlyDictionary<string, bool>> ListStates(CancellationToken ct)
    {
        var groups = Plugins.Select(plugin => "plugin:" + plugin.Id).ToArray();
        var settings = await db.Settings.AsNoTracking().Where(item => groups.Contains(item.Group))
            .ToDictionaryAsync(item => item.Group, item => item.Json, ct);
        return Plugins.ToDictionary(plugin => plugin.Id, plugin =>
            settings.TryGetValue("plugin:" + plugin.Id, out var json)
                ? JsonSerializer.Deserialize<bool>(json)
                : plugin.DefaultEnabled);
    }

    public async Task<bool> IsEnabled(string id, CancellationToken ct)
    {
        var item = await db.Settings.AsNoTracking().SingleOrDefaultAsync(x => x.Group == "plugin:" + id, ct);
        var plugin = Plugins.SingleOrDefault(x => x.Id == id);
        return plugin is not null && (item is null ? plugin.DefaultEnabled : JsonSerializer.Deserialize<bool>(item.Json));
    }

    public async Task SetEnabled(string id, bool enabled, CancellationToken ct)
    {
        var plugin = Plugins.SingleOrDefault(x => x.Id == id) ?? throw new ArgumentException("Unknown plugin", nameof(id));
        if (enabled && !await plugin.IsReady(services, ct)) throw new InvalidOperationException("Plugin is not configured");
        var item = await db.Settings.SingleOrDefaultAsync(x => x.Group == "plugin:" + id, ct);
        if (item is null) db.Settings.Add(new Setting { Group = "plugin:" + id, Json = JsonSerializer.Serialize(enabled) });
        else item.Json = JsonSerializer.Serialize(enabled);
        await db.SaveChangesAsync(ct);
    }
}
