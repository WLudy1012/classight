using System.Reflection;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.EntityFrameworkCore;

namespace Classight.Plugins;

public sealed record PluginRuntimeStatus(string FileName, string[] PluginIds, string State, string? Version, string? Error, DateTimeOffset? LoadedAt, int ReloadCount);

public sealed class PluginServiceLease<T> : IDisposable, IAsyncDisposable where T : class
{
    private readonly Func<ValueTask> release;
    private T? service;
    internal PluginServiceLease(T service, Func<ValueTask> release) { this.service = service; this.release = release; }
    public T Service => service ?? throw new ObjectDisposedException(nameof(PluginServiceLease<T>));
    public void Dispose() => DisposeAsync().AsTask().GetAwaiter().GetResult();
    public async ValueTask DisposeAsync() { if (service is null) return; service = null; await release(); }
}

public sealed class PluginRuntime : IAsyncDisposable
{
    private readonly IServiceProvider host;
    private readonly IConfiguration configuration;
    private readonly ILogger<PluginRuntime> logger;
    private readonly string directory;
    private readonly SemaphoreSlim reloadGate = new(1, 1);
    private readonly Dictionary<string, LoadedPlugin> active = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, PluginRuntimeStatus> status = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> observed = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> retryAfter = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<WeakReference> unloaded = [];
    private readonly List<(WeakReference Context, string Shadow)> retiredShadows = [];
    private readonly HashSet<Task> retirements = [];
    private readonly object gate = new();
    private IEndpointRouteBuilder? endpoints;
    private bool initialized;
    private bool disposed;
    private long generation;
    internal PluginEndpointSource Source { get; } = new();

    public PluginRuntime(IServiceProvider host, IConfiguration configuration, ILogger<PluginRuntime> logger, string defaultDirectory)
    {
        this.host = host; this.configuration = configuration; this.logger = logger;
        directory = Path.GetFullPath(configuration["Plugins:Directory"] ?? defaultDirectory);
    }

    public string DirectoryPath => directory;
    public event Action? Changed;
    public IReadOnlyList<PluginManifest> Manifests { get { lock (gate) return active.Values.SelectMany(p => p.Manifests).ToArray(); } }
    public IReadOnlyList<PermissionDefinition> Permissions { get { lock (gate) return active.Values.SelectMany(p => p.Permissions).ToArray(); } }
    public IReadOnlyList<IManagedPlugin> ManagedPlugins => Manifests.Select(m => (IManagedPlugin)new ManagedProxy(this, m.Id)).ToArray();
    public IReadOnlyList<PluginRuntimeStatus> Status { get { lock (gate) return status.Values.OrderBy(s => s.FileName).ToArray(); } }
    public IReadOnlyList<WeakReference> UnloadedContexts { get { lock (gate) return unloaded.ToArray(); } }

    internal void Attach(IEndpointRouteBuilder builder)
    {
        endpoints = builder;
        builder.DataSources.Add(Source);
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        Directory.CreateDirectory(directory);
        await ReloadAsync(ct, force: !initialized);
        initialized = true;
    }

    public async Task ReloadAsync(CancellationToken ct = default, bool force = true)
    {
        if (disposed) return;
        await reloadGate.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(directory);
            CleanupShadows();
            var files = Directory.EnumerateFiles(directory, "*.dll").Concat(Directory.EnumerateDirectories(directory)
                .Where(p => !Path.GetFileName(p).StartsWith('.')).SelectMany(p => Directory.EnumerateFiles(p, "*.dll"))).Order(StringComparer.Ordinal).ToArray();
            var topologyChanged = false;
            foreach (var file in files)
            {
                ct.ThrowIfCancellationRequested();
                string fingerprint;
                try { fingerprint = Fingerprint(file); }
                catch (IOException) { continue; }
                if (!force && observed.TryGetValue(file, out var oldFingerprint) && oldFingerprint == fingerprint &&
                    (!retryAfter.TryGetValue(file, out var retry) || retry > DateTimeOffset.UtcNow)) continue;
                LoadedPlugin? candidate = null;
                try
                {
                    candidate = await Load(file, fingerprint, ct);
                    if (candidate is null)
                    {
                        lock (gate) if (active.ContainsKey(file)) throw new InvalidOperationException("The replacement DLL does not contain a plugin module");
                        observed[file] = fingerprint; retryAfter.Remove(file); continue;
                    }
                    LoadedPlugin? previous;
                    lock (gate)
                    {
                        active.TryGetValue(file, out previous);
                        Validate(candidate, previous);
                    }
                    await candidate.Start(ct);
                    lock (gate)
                    {
                        active[file] = candidate;
                        observed[file] = fingerprint;
                        retryAfter.Remove(file);
                        status.TryGetValue(file, out var oldStatus);
                        status[file] = new(Path.GetRelativePath(directory, file), candidate.Manifests.Select(m => m.Id).ToArray(), "active", string.Join(", ", candidate.Manifests.Select(m => m.Version)), null, DateTimeOffset.UtcNow, (oldStatus?.ReloadCount ?? 0) + 1);
                        Source.Replace(active.Values.SelectMany(p => p.Endpoints).ToArray());
                    }
                    candidate = null;
                    topologyChanged = true;
                    Notify();
                    if (previous is not null) ScheduleRetirement(previous);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    logger.LogError(ex, "Plugin reload failed for {File}; the previous generation remains active", Path.GetFileName(file));
                    lock (gate)
                    {
                        status.TryGetValue(file, out var oldStatus);
                        status[file] = new(Path.GetRelativePath(directory, file), oldStatus?.PluginIds ?? [], active.ContainsKey(file) ? "reload_failed" : "load_failed", oldStatus?.Version, $"{ex.GetBaseException().GetType().Name}: plugin validation or startup failed; see daemon logs", oldStatus?.LoadedAt, oldStatus?.ReloadCount ?? 0);
                    }
                    observed[file] = fingerprint;
                    retryAfter[file] = DateTimeOffset.UtcNow.AddSeconds(30);
                }
                finally { if (candidate is not null) await Retire(candidate); }
            }
            foreach (var removed in active.Keys.Where(file => !files.Contains(file, StringComparer.OrdinalIgnoreCase)).ToArray())
            {
                LoadedPlugin previous;
                lock (gate)
                {
                    previous = active[removed]; active.Remove(removed); observed.Remove(removed); retryAfter.Remove(removed);
                    var old = status[removed]; status[removed] = old with { State = "unloaded", Error = null };
                    Source.Replace(active.Values.SelectMany(p => p.Endpoints).ToArray());
                }
                Notify();
                topologyChanged = true;
                ScheduleRetirement(previous);
            }
            foreach (var missing in retryAfter.Keys.Where(file => !files.Contains(file, StringComparer.OrdinalIgnoreCase)).ToArray())
            {
                retryAfter.Remove(missing); observed.Remove(missing);
                lock (gate) if (status.TryGetValue(missing, out var old)) status[missing] = old with { State = "unloaded", Error = null };
            }
            if (topologyChanged)
                foreach (var failed in retryAfter.Keys) observed.Remove(failed);
        }
        finally { reloadGate.Release(); }
    }

    public bool TryAcquireService<T>([NotNullWhen(true)] out PluginServiceLease<T>? lease) where T : class
    {
        lock (gate)
        {
            foreach (var plugin in active.Values)
            {
                if (!plugin.Services.Declares(typeof(T)) || !plugin.Enter()) continue;
                PluginServices? scope = null;
                try
                {
                    scope = (PluginServices)plugin.Services.CreateScope().ServiceProvider;
                    var service = scope.GetRequiredService<T>();
                    var acquiredScope = scope;
                    lease = new(service, async () => { try { await acquiredScope.DisposeAsync(); } finally { plugin.Exit(); } });
                    return true;
                }
                catch
                {
                    scope?.DisposeAsync().AsTask().GetAwaiter().GetResult(); plugin.Exit(); throw;
                }
            }
        }
        lease = null; return false;
    }

    private async Task<LoadedPlugin?> Load(string path, string fingerprint, CancellationToken ct)
    {
        var shadow = Path.Combine(directory, ".cache", Path.GetFileNameWithoutExtension(path), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(shadow);
        var sourceRoot = Path.GetDirectoryName(path)!;
        foreach (var source in Directory.EnumerateFiles(sourceRoot, "*", SearchOption.TopDirectoryOnly).Where(p => Path.GetExtension(p) is ".dll" or ".json" or ".so" or ".dylib"))
            File.Copy(source, Path.Combine(shadow, Path.GetFileName(source)));
        var native = Path.Combine(sourceRoot, "runtimes");
        if (Directory.Exists(native))
            foreach (var source in Directory.EnumerateFiles(native, "*", SearchOption.AllDirectories))
            {
                var target = Path.Combine(shadow, Path.GetRelativePath(sourceRoot, source)); Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(source, target);
            }
        var context = new PluginLoadContext(Path.Combine(shadow, Path.GetFileName(path)));
        PluginServices? provider = null;
        try
        {
            var assembly = context.LoadFromAssemblyPath(Path.Combine(shadow, Path.GetFileName(path)));
            var types = assembly.GetTypes().Where(t => !t.IsAbstract && !t.IsInterface && typeof(IPluginModule).IsAssignableFrom(t)).ToArray();
            if (types.Length == 0) { TrackUnload(context, shadow); context.Unload(); TryDelete(shadow); return null; }
            var modules = types.Select(t => (IPluginModule)Activator.CreateInstance(t)!).ToArray();
            var manifests = modules.Select(m => m.Manifest with { Generation = $"{fingerprint[..12]}-{Interlocked.Increment(ref generation)}" }).ToArray();
            foreach (var manifest in manifests)
            {
                if (manifest.Id.Length is < 1 or > 64 || manifest.Id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) throw new InvalidOperationException("Plugin IDs must contain ASCII letters, digits or hyphens");
                if (manifest.WorkspacePath is { } workspace && (workspace.Length == 0 || workspace.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) || workspace.Split('/')[0].Equals("account", StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidOperationException("Plugin workspace path is invalid or reserved");
                if (manifest.UiEntry is { } entry && (!entry.StartsWith($"/api/v1/plugins/{manifest.Id}/ui/", StringComparison.Ordinal) || entry.Contains("..", StringComparison.Ordinal) || entry.Contains('?') || entry.Contains('#')))
                    throw new InvalidOperationException("Plugin UI entry must point to its embedded UI route");
                if (manifest.UiEntry is { } ui)
                {
                    var resourcePath = ui[($"/api/v1/plugins/{manifest.Id}/ui/").Length..];
                    if (resourcePath.Length == 0) resourcePath = "index.html";
                    var names = assembly.GetManifestResourceNames();
                    if (!names.Contains("Classight.PluginUi." + resourcePath) && !names.Contains("Classight.PluginUi." + resourcePath.Replace('/', '.')))
                        throw new InvalidOperationException("Plugin UI entry does not exist in embedded resources");
                }
            }
            var services = new ServiceCollection();
            foreach (var module in modules) module.AddServices(services, configuration);
            if (!services.Any(service => service.ServiceType == typeof(IManagedPlugin)))
                foreach (var manifest in manifests) services.AddSingleton<IManagedPlugin>(new ManagedPlugin(manifest.Id, false));
            services.AddScoped(sp =>
            {
                var options = new DbContextOptionsBuilder<AppDbContext>();
                sp.GetRequiredService<DatabaseConfig>().Configure(options);
                options.EnableServiceProviderCaching(false);
                return new AppDbContext(options.Options);
            });
            var json = new JsonOptions(); json.SerializerOptions.TypeInfoResolver = new DefaultJsonTypeInfoResolver(); json.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
            services.AddSingleton<IOptions<JsonOptions>>(Options.Create(json));
            provider = new PluginServices(services, host);
            var managedIds = provider.GetServices<IManagedPlugin>().Select(plugin => plugin.Id).ToArray();
            if (manifests.Any(manifest => !managedIds.Contains(manifest.Id))) throw new InvalidOperationException("Each plugin manifest must have a managed-plugin declaration");
            var routes = new PluginRouteBuilder(provider);
            var group = routes.MapGroup("").ExcludeFromDescription();
            ((IEndpointConventionBuilder)group).Add(ValidateBindings);
            foreach (var module in modules) module.MapEndpoints(group);
            foreach (var module in modules.Where(m => m.Manifest.UiEntry is not null)) AddUi(group, module.Manifest, assembly);
            var result = new LoadedPlugin(context, provider, shadow, manifests, modules.SelectMany(m => m.DeclarePermissions()).ToArray());
            result.Endpoints = routes.DataSources.SelectMany(s => s.Endpoints).Select(endpoint => Wrap(endpoint, result)).ToArray();
            await Task.CompletedTask;
            return result;
        }
        catch
        {
            try { if (provider is not null) await provider.DisposeAsync(); }
            catch (Exception ex) { logger.LogError(ex, "Failed plugin startup cleanup failed"); }
            finally { TrackUnload(context, shadow); context.Unload(); TryDelete(shadow); }
            throw;
        }
    }

    private static void ValidateBindings(EndpointBuilder endpoint)
    {
        foreach (var method in endpoint.Metadata.OfType<MethodInfo>())
            foreach (var parameter in method.GetParameters())
                if (Collectible(parameter.ParameterType) && !parameter.GetCustomAttributes().Any(attribute => attribute is IFromBodyMetadata or IFromServiceMetadata))
                    throw new InvalidOperationException($"Plugin parameter '{parameter.Name}' must use explicit FromBody or FromServices binding to support unloading");
    }

    private static bool Collectible(Type type) => type.Assembly.IsCollectible || type.HasElementType && Collectible(type.GetElementType()!) || type.IsConstructedGenericType && type.GenericTypeArguments.Any(Collectible);

    private static Endpoint Wrap(Endpoint endpoint, LoadedPlugin plugin)
    {
        if (endpoint is not RouteEndpoint route || endpoint.RequestDelegate is null) throw new InvalidOperationException("Plugins must declare HTTP route endpoints");
        var handler = endpoint.RequestDelegate;
        return new RouteEndpoint(async http =>
        {
            if (!plugin.Enter()) { http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable; return; }
            var original = http.RequestServices;
            var scope = plugin.Services.ForRequest(original);
            try { http.RequestServices = scope; await handler(http); }
            finally { http.RequestServices = original; try { await scope.DisposeAsync(); } finally { plugin.Exit(); } }
        }, route.RoutePattern, route.Order, route.Metadata, route.DisplayName);
    }

    private void Validate(LoadedPlugin candidate, LoadedPlugin? previous)
    {
        var others = active.Values.Where(p => !ReferenceEquals(p, previous)).ToArray();
        if (candidate.Manifests.Select(m => m.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != candidate.Manifests.Length ||
            others.SelectMany(p => p.Manifests).Any(m => candidate.Manifests.Any(n => n.Id.Equals(m.Id, StringComparison.OrdinalIgnoreCase)))) throw new InvalidOperationException("Duplicate plugin ID");
        var paths = candidate.Manifests.Where(m => m.WorkspacePath is not null).Select(m => m.WorkspacePath!).ToArray();
        if (paths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length || others.SelectMany(p => p.Manifests).Any(m => m.WorkspacePath is not null && paths.Contains(m.WorkspacePath, StringComparer.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Duplicate plugin workspace path");
        var ownPermissions = candidate.Permissions.Select(p => p.Code).ToArray();
        var oldPermissions = previous?.Permissions.Select(p => p.Code).ToHashSet(StringComparer.Ordinal) ?? [];
        var registered = (host.GetService<IPermissionCatalog>()?.All.Select(p => p.Code).Where(code => !oldPermissions.Contains(code)) ?? [])
            .Concat(others.SelectMany(p => p.Permissions).Select(p => p.Code)).ToHashSet(StringComparer.Ordinal);
        if (ownPermissions.Distinct().Count() != ownPermissions.Length || ownPermissions.Any(registered.Contains)) throw new InvalidOperationException("Duplicate plugin permission");
        var baseline = endpoints?.DataSources.Where(source => !ReferenceEquals(source, Source)).SelectMany(source => source.Endpoints).Concat(others.SelectMany(p => p.Endpoints)).ToArray() ?? [];
        var current = new List<Endpoint>(baseline);
        foreach (var endpoint in candidate.Endpoints)
        {
            var route = (RouteEndpoint)endpoint;
            foreach (var other in current.OfType<RouteEndpoint>())
            {
                if (!string.Equals(route.RoutePattern.RawText, other.RoutePattern.RawText, StringComparison.OrdinalIgnoreCase)) continue;
                var a = route.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                var b = other.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                if (a is null || b is null || a.Intersect(b, StringComparer.OrdinalIgnoreCase).Any()) throw new InvalidOperationException($"Plugin route conflicts with an existing endpoint: {route.RoutePattern.RawText}");
            }
            current.Add(endpoint);
        }
    }

    private static void AddUi(IEndpointRouteBuilder endpoints, PluginManifest manifest, Assembly assembly)
    {
        endpoints.MapGet($"/api/v1/plugins/{manifest.Id}/ui/{{**path}}", async (HttpContext http, string? path) =>
        {
            path = string.IsNullOrEmpty(path) ? "index.html" : path;
            if (path.Split('/').Any(p => p is "." or "..")) { http.Response.StatusCode = 404; return; }
            using var stream = assembly.GetManifestResourceStream("Classight.PluginUi." + path) ?? assembly.GetManifestResourceStream("Classight.PluginUi." + path.Replace('/', '.'));
            if (stream is null) { http.Response.StatusCode = 404; return; }
            http.Response.Headers.AccessControlAllowOrigin = "*";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.ContentType = new FileExtensionContentTypeProvider().TryGetContentType(path, out var contentType) ? contentType : "application/octet-stream";
            await stream.CopyToAsync(http.Response.Body, http.RequestAborted);
        }).AllowAnonymous();
    }

    private static string Fingerprint(string file)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var root = Path.GetDirectoryName(file)!;
        var native = Path.Combine(root, "runtimes");
        var files = Directory.EnumerateFiles(root).Where(p => Path.GetExtension(p) is ".dll" or ".json" or ".so" or ".dylib")
            .Concat(Directory.Exists(native) ? Directory.EnumerateFiles(native, "*", SearchOption.AllDirectories) : []);
        foreach (var path in files.Order(StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(Path.GetRelativePath(root, path)));
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var buffer = new byte[81920]; int read;
            while ((read = stream.Read(buffer)) > 0) hash.AppendData(buffer.AsSpan(0, read));
        }
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private async Task Retire(LoadedPlugin plugin)
    {
        TrackUnload(plugin.Context, plugin.Shadow);
        try { await plugin.Retire(); }
        catch (Exception ex) { logger.LogError(ex, "Plugin cleanup failed"); }
    }
    private void TrackUnload(AssemblyLoadContext context, string shadow)
    {
        var weak = new WeakReference(context);
        lock (gate) { unloaded.Add(weak); retiredShadows.Add((weak, shadow)); }
    }
    private void CleanupShadows()
    {
        (WeakReference Context, string Shadow)[] eligible;
        lock (gate) eligible = retiredShadows.Where(item => !item.Context.IsAlive).ToArray();
        foreach (var item in eligible)
        {
            TryDelete(item.Shadow);
            if (!Directory.Exists(item.Shadow)) lock (gate) retiredShadows.Remove(item);
        }
    }
    private void ScheduleRetirement(LoadedPlugin plugin)
    {
        var task = Retire(plugin);
        lock (gate) retirements.Add(task);
        _ = task.ContinueWith(completed => { lock (gate) retirements.Remove(completed); }, TaskScheduler.Default);
    }
    private void Notify() { try { Changed?.Invoke(); } catch (Exception ex) { logger.LogError(ex, "Plugin change subscriber failed"); } }
    private static void TryDelete(string path) { try { Directory.Delete(path, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return; disposed = true;
        await reloadGate.WaitAsync();
        try
        {
            LoadedPlugin[] remaining;
            lock (gate) { remaining = active.Values.ToArray(); active.Clear(); Source.Replace([]); }
            foreach (var plugin in remaining) await Retire(plugin);
            Task[] pending;
            lock (gate) pending = retirements.ToArray();
            await Task.WhenAll(pending);
            Source.Dispose();
        }
        finally { reloadGate.Release(); }
    }

    private sealed class ManagedProxy(PluginRuntime runtime, string id) : IManagedPlugin
    {
        public string Id => id;
        public bool DefaultEnabled => Read(p => p.DefaultEnabled, false);
        public IReadOnlyList<string> Dependencies => Read(p => p.Dependencies.ToArray(), Array.Empty<string>());
        private T Read<T>(Func<IManagedPlugin, T> read, T fallback)
        {
            lock (runtime.gate)
                foreach (var plugin in runtime.active.Values)
                    if (plugin.Manifests.Any(m => m.Id == id))
                    {
                        var managed = plugin.Services.GetServices<IManagedPlugin>().SingleOrDefault(p => p.Id == id);
                        return managed is null ? fallback : read(managed);
                    }
            return fallback;
        }
        public async Task<bool> IsReady(IServiceProvider services, CancellationToken ct)
        {
            LoadedPlugin? plugin;
            lock (runtime.gate) plugin = runtime.active.Values.FirstOrDefault(p => p.Manifests.Any(m => m.Id == id));
            if (plugin is null || !plugin.Enter()) return false;
            var scope = plugin.Services.ForRequest(services);
            try { var managed = scope.GetServices<IManagedPlugin>().SingleOrDefault(p => p.Id == id); return managed is not null && await managed.IsReady(scope, ct); }
            finally { try { await scope.DisposeAsync(); } finally { plugin.Exit(); } }
        }
    }

    private sealed class PluginLoadContext(string path) : AssemblyLoadContext(isCollectible: true)
    {
        private readonly AssemblyDependencyResolver resolver = new(path);
        private readonly string root = Path.GetDirectoryName(path)!;
        protected override Assembly? Load(AssemblyName name)
        {
            if (name.Name is "Classight.SharedKernel" or "Classight.Contracts" or "Classight.Platform")
                return Default.Assemblies.FirstOrDefault(a => a.GetName().Name == name.Name) ?? Default.LoadFromAssemblyName(name);
            if (name.Name!.StartsWith("System.") || name.Name.StartsWith("Microsoft.") || name.Name is "System" or "netstandard")
            {
                var shared = Default.Assemblies.FirstOrDefault(a => a.GetName().Name == name.Name);
                if (shared is not null) return shared;
                try { return Default.LoadFromAssemblyName(name); }
                catch (FileNotFoundException) { }
            }
            var resolved = resolver.ResolveAssemblyToPath(name);
            if (resolved is not null) return LoadFromAssemblyPath(resolved);
            var sibling = Path.Combine(root, name.Name + ".dll");
            return File.Exists(sibling) ? LoadFromAssemblyPath(sibling) : null;
        }
        protected override nint LoadUnmanagedDll(string name)
        {
            var resolved = resolver.ResolveUnmanagedDllToPath(name);
            return resolved is null ? 0 : LoadUnmanagedDllFromPath(resolved);
        }
    }

    private sealed class PluginRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider => services;
        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();
        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(services);
    }

    private sealed class LoadedPlugin(AssemblyLoadContext context, PluginServices services, string shadow, PluginManifest[] manifests, PermissionDefinition[] permissions)
    {
        private int requests;
        private bool retiring;
        private readonly object state = new();
        private TaskCompletionSource? drained;
        private IHostedService[] hosted = [];
        public AssemblyLoadContext Context { get; private set; } = context;
        public PluginServices Services { get; private set; } = services;
        public string Shadow => shadow;
        public PluginManifest[] Manifests { get; } = manifests;
        public PermissionDefinition[] Permissions { get; } = permissions;
        public Endpoint[] Endpoints { get; set; } = [];
        public bool Enter() { lock (state) { if (retiring) return false; requests++; return true; } }
        public void Exit() { lock (state) { if (--requests == 0) drained?.TrySetResult(); } }
        public async Task Start(CancellationToken ct)
        {
            if (Services.Declares(typeof(IHostedService))) hosted = Services.GetServices<IHostedService>().ToArray();
            foreach (var service in hosted) await service.StartAsync(ct);
        }
        public async Task Retire()
        {
            Task pending;
            lock (state) { retiring = true; pending = requests == 0 ? Task.CompletedTask : (drained = new(TaskCreationOptions.RunContinuationsAsynchronously)).Task; }
            await pending;
            var errors = new List<Exception>();
            foreach (var service in hosted.Reverse())
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try { await service.StopAsync(timeout.Token); }
                catch (Exception ex) { errors.Add(ex); }
            }
            try { await Services.DisposeAsync(); }
            catch (Exception ex) { errors.Add(ex); }
            finally
            {
                hosted = []; Endpoints = [];
                var old = Context; Context = null!; Services = null!;
                old.Unload(); TryDelete(shadow);
            }
            if (errors.Count > 0) throw new AggregateException("Plugin cleanup failed", errors);
        }
    }
}

internal sealed class PluginEndpointSource : EndpointDataSource, IDisposable
{
    private Endpoint[] endpoints = [];
    private CancellationTokenSource changed = new();
    private readonly object gate = new();
    private bool disposed;
    public override IReadOnlyList<Endpoint> Endpoints => Volatile.Read(ref endpoints);
    public override IChangeToken GetChangeToken() { lock (gate) return new CancellationChangeToken(disposed ? CancellationToken.None : changed.Token); }
    public void Replace(Endpoint[] value)
    {
        CancellationTokenSource previous;
        lock (gate)
        {
            if (disposed) return;
            Volatile.Write(ref endpoints, value);
            previous = changed; changed = new CancellationTokenSource();
        }
        previous.Cancel(); previous.Dispose();
    }
    public void Dispose()
    {
        CancellationTokenSource previous;
        lock (gate) { if (disposed) return; disposed = true; Volatile.Write(ref endpoints, []); previous = changed; }
        previous.Dispose();
    }
}

public static class PluginRuntimeExtensions
{
    public static IServiceCollection AddClassightPluginRuntime(this IServiceCollection services, IConfiguration configuration, string pluginDirectory)
    {
        services.AddSingleton(sp => new PluginRuntime(sp, configuration, sp.GetRequiredService<ILogger<PluginRuntime>>(), pluginDirectory));
        services.AddHostedService<PluginWatcher>();
        return services;
    }
    public static IApplicationBuilder UseClassightPlugins(this WebApplication app)
    {
        app.Services.GetRequiredService<PluginRuntime>().Attach(app);
        return app;
    }
    private sealed class PluginWatcher(PluginRuntime runtime, ILogger<PluginWatcher> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
            while (await timer.WaitForNextTickAsync(stoppingToken))
                try { await runtime.ReloadAsync(stoppingToken, false); }
                catch (Exception ex) when (ex is not OperationCanceledException) { logger.LogError(ex, "Plugin scan failed"); }
        }
    }
}
