using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Classight.Plugins;

internal sealed class PluginServices : IServiceProvider, IServiceProviderIsService, IServiceScopeFactory, IAsyncDisposable
{
    private readonly PluginServices root;
    private readonly IServiceProvider host;
    private readonly IServiceScope? ownedHostScope;
    private ServiceDescriptor[] descriptors;
    private readonly Dictionary<(ServiceDescriptor, Type), object> instances = new();
    private readonly List<object> owned = [];
    private readonly HashSet<Type> resolving = [];
    private readonly object gate = new();
    private bool disposed;

    public PluginServices(IEnumerable<ServiceDescriptor> descriptors, IServiceProvider host)
    {
        this.descriptors = descriptors.ToArray();
        this.host = host;
        root = this;
    }

    private PluginServices(PluginServices root, IServiceProvider host, IServiceScope? ownedHostScope)
    {
        this.root = root;
        this.host = host;
        this.ownedHostScope = ownedHostScope;
        descriptors = root.descriptors;
    }

    public PluginServices ForRequest(IServiceProvider hostScope) => new(root, hostScope, null);
    public IServiceScope CreateScope()
    {
        var scope = host.GetRequiredService<IServiceScopeFactory>().CreateScope();
        return new Scope(new PluginServices(root, scope.ServiceProvider, scope));
    }

    public bool Declares(Type type) => descriptors.Any(d => !d.IsKeyedService && (d.ServiceType == type || type.IsConstructedGenericType && d.ServiceType == type.GetGenericTypeDefinition()));

    public bool IsService(Type type)
    {
        if (type == typeof(IServiceProvider) || type == typeof(IServiceScopeFactory) || type == typeof(IServiceProviderIsService) || Declares(type)) return true;
        if (type.IsConstructedGenericType && (type.GetGenericTypeDefinition() == typeof(IEnumerable<>) || type.GetGenericTypeDefinition() == typeof(ILogger<>))) return true;
        return !Collectible(type) && (host.GetService<IServiceProviderIsService>()?.IsService(type) ?? false);
    }

    public object? GetService(Type type)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (type == typeof(IServiceProvider) || type == typeof(IServiceScopeFactory) || type == typeof(IServiceProviderIsService)) return this;
        if (type.IsConstructedGenericType && type.GetGenericTypeDefinition() == typeof(IEnumerable<>))
        {
            var item = type.GetGenericArguments()[0];
            var matches = descriptors.Where(d => !d.IsKeyedService && (d.ServiceType == item || item.IsConstructedGenericType && d.ServiceType == item.GetGenericTypeDefinition())).ToArray();
            if (matches.Length == 0) return Collectible(item) ? Array.CreateInstance(item, 0) : host.GetService(type) ?? Array.CreateInstance(item, 0);
            var array = Array.CreateInstance(item, matches.Length);
            for (var i = 0; i < matches.Length; i++) array.SetValue(Resolve(matches[i], item), i);
            return array;
        }
        var descriptor = descriptors.LastOrDefault(d => !d.IsKeyedService && d.ServiceType == type);
        descriptor ??= type.IsConstructedGenericType ? descriptors.LastOrDefault(d => !d.IsKeyedService && d.ServiceType == type.GetGenericTypeDefinition()) : null;
        if (descriptor is not null) return Resolve(descriptor, type);
        if (type.IsConstructedGenericType && type.GetGenericTypeDefinition() == typeof(ILogger<>))
            return Activator.CreateInstance(typeof(Logger<>).MakeGenericType(type.GenericTypeArguments), host.GetRequiredService<ILoggerFactory>());
        return Collectible(type) ? null : host.GetService(type);
    }

    private object Resolve(ServiceDescriptor descriptor, Type requested)
    {
        var owner = descriptor.Lifetime == ServiceLifetime.Singleton ? root : this;
        lock (owner.gate)
        {
            if (descriptor.Lifetime != ServiceLifetime.Transient && owner.instances.TryGetValue((descriptor, requested), out var cached)) return cached;
            if (!owner.resolving.Add(requested)) throw new InvalidOperationException($"Circular plugin service dependency: {requested.FullName}");
            try
            {
                var implementation = descriptor.ImplementationType;
                if (implementation?.IsGenericTypeDefinition == true) implementation = implementation.MakeGenericType(requested.GenericTypeArguments);
                var value = descriptor.ImplementationInstance ?? descriptor.ImplementationFactory?.Invoke(owner) ?? (implementation is null ? null : owner.Construct(implementation));
                if (value is null) throw new InvalidOperationException($"Unable to construct plugin service {requested.FullName}");
                if (descriptor.Lifetime != ServiceLifetime.Transient) owner.instances[(descriptor, requested)] = value;
                if (value is IDisposable or IAsyncDisposable && !owner.owned.Any(item => ReferenceEquals(item, value))) owner.owned.Add(value);
                return value;
            }
            finally { owner.resolving.Remove(requested); }
        }
    }

    private object Construct(Type implementation)
    {
        var constructors = implementation.GetConstructors();
        var preferred = constructors.Where(c => c.IsDefined(typeof(ActivatorUtilitiesConstructorAttribute))).ToArray();
        foreach (var constructor in preferred.Length > 0 ? preferred : constructors.OrderByDescending(c => c.GetParameters().Length).ToArray())
        {
            var parameters = constructor.GetParameters();
            if (parameters.Any(p => !p.HasDefaultValue && !IsService(p.ParameterType))) continue;
            return constructor.Invoke(parameters.Select(p => GetService(p.ParameterType) ?? (p.HasDefaultValue ? p.DefaultValue : throw new InvalidOperationException($"Missing plugin dependency {p.ParameterType.FullName}"))).ToArray());
        }
        throw new InvalidOperationException($"No resolvable constructor for {implementation.FullName}");
    }

    private static bool Collectible(Type type) => type.Assembly.IsCollectible || type.HasElementType && Collectible(type.GetElementType()!) || type.IsConstructedGenericType && type.GenericTypeArguments.Any(Collectible);

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        var errors = new List<Exception>();
        foreach (var item in owned.AsEnumerable().Reverse())
        {
            try
            {
                if (item is IAsyncDisposable asyncDisposable) await asyncDisposable.DisposeAsync();
                else if (item is IDisposable disposable) disposable.Dispose();
            }
            catch (Exception ex) { errors.Add(ex); }
        }
        owned.Clear(); instances.Clear(); descriptors = [];
        try
        {
            if (ownedHostScope is IAsyncDisposable scope) await scope.DisposeAsync();
            else ownedHostScope?.Dispose();
        }
        catch (Exception ex) { errors.Add(ex); }
        if (errors.Count > 0) throw new AggregateException(errors);
    }

    private sealed class Scope(PluginServices services) : IServiceScope, IAsyncDisposable
    {
        public IServiceProvider ServiceProvider => services;
        public void Dispose() => services.DisposeAsync().AsTask().GetAwaiter().GetResult();
        public ValueTask DisposeAsync() => services.DisposeAsync();
    }
}
