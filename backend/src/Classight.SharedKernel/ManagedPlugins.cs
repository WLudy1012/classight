namespace Classight.SharedKernel;

public interface IManagedPlugin
{
    string Id { get; }
    bool DefaultEnabled { get; }
    IReadOnlyList<string> Dependencies => [];
    Task<bool> IsReady(IServiceProvider services, CancellationToken ct);
}

public sealed record ManagedPlugin(string Id, bool DefaultEnabled) : IManagedPlugin
{
    public Task<bool> IsReady(IServiceProvider services, CancellationToken ct) => Task.FromResult(true);
}
