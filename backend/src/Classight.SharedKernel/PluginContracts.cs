namespace Classight.SharedKernel;

public sealed record PluginManifest(string Id, string Name, string Description, string Version,
    string? WorkspacePath = null, string Category = "class", string? Permission = null,
    string Icon = "grid", string? UiEntry = null, string? Generation = null);

public interface IPluginModule : IModule
{
    PluginManifest Manifest { get; }
}
