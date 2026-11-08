using System.Text.Json;
using System.Security.Cryptography;
using System.Threading.Channels;
using Classight.Contracts;
using Classight.Platform;
using Classight.Plugins;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Classight.Api;

public static class BuiltinPluginInstaller
{
    public static void Ensure(string directory)
    {
        Directory.CreateDirectory(directory);
        var marker = Path.Combine(directory, ".bundled-plugins-installed");
        Dictionary<string, string?> installed = [];
        if (File.Exists(marker))
        {
            try { installed = JsonSerializer.Deserialize<Dictionary<string, string?>>(File.ReadAllText(marker)) ?? []; }
            catch (JsonException) { installed = File.ReadAllLines(marker).Where(line => !string.IsNullOrWhiteSpace(line)).ToDictionary(name => name, _ => (string?)null); }
        }
        var assembly = typeof(Program).Assembly;
        foreach (var resource in assembly.GetManifestResourceNames().Where(name => name.StartsWith("Classight.BuiltinPlugins.", StringComparison.Ordinal)))
        {
            var name = resource["Classight.BuiltinPlugins.".Length..];
            var path = Path.Combine(directory, name);
            using var source = assembly.GetManifestResourceStream(resource)!;
            using var buffer = new MemoryStream();
            source.CopyTo(buffer);
            var bytes = buffer.ToArray();
            var bundledHash = Convert.ToHexString(SHA256.HashData(bytes));
            var exists = File.Exists(path);
            var tracked = installed.TryGetValue(name, out var previousHash);
            var currentHash = exists ? Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))) : null;
            if (!tracked && !exists || exists && previousHash is not null && currentHash == previousHash && currentHash != bundledHash)
            {
                var temporary = path + ".installing";
                File.WriteAllBytes(temporary, bytes);
                File.Move(temporary, path, overwrite: tracked);
                installed[name] = bundledHash;
            }
            else if (currentHash == bundledHash) installed[name] = bundledHash;
            else if (!tracked) installed[name] = null;
        }
        var markerTemporary = marker + ".writing";
        File.WriteAllText(markerTemporary, JsonSerializer.Serialize(installed));
        File.Move(markerTemporary, marker, overwrite: true);
    }
}

public sealed class RuntimePermissionCatalog(IEnumerable<PermissionDefinition> core, PluginRuntime plugins) : IPermissionCatalog
{
    private readonly PermissionDefinition[] core = core.ToArray();
    public IReadOnlyList<PermissionDefinition> All => core.Concat(plugins.Permissions).DistinctBy(item => item.Code).ToArray();
}

public sealed class PluginPolicyProvider(IOptions<AuthorizationOptions> options) : DefaultAuthorizationPolicyProvider(options)
{
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName) =>
        await base.GetPolicyAsync(policyName) ?? (policyName.Contains('.')
            ? new AuthorizationPolicyBuilder().RequireAuthenticatedUser().RequireClaim("permission", policyName).Build()
            : null);
}

public sealed class ReloadableCaptcha(PluginRuntime plugins, DatabaseConfig database, IServiceProvider services) : ICaptchaVerification
{
    private async Task RequireUnavailable(CancellationToken ct)
    {
        if (!database.Configured) return;
        var db = services.GetRequiredService<AppDbContext>();
        var value = await db.Settings.AsNoTracking().Where(item => item.Group == "plugin:captcha").Select(item => item.Json).SingleOrDefaultAsync(ct);
        if (value is not null && JsonSerializer.Deserialize<bool>(value))
            throw new ApiException(503, "plugin.unavailable", "人机验证插件未加载，请联系管理员恢复插件");
    }

    public async Task<CaptchaPublicConfiguration> Public(CancellationToken ct)
    {
        if (plugins.TryAcquireService<ICaptchaVerification>(out var lease))
        {
            await using (lease) return await lease.Service.Public(ct);
        }
        await RequireUnavailable(ct);
        return new(false);
    }

    public async Task Verify(CaptchaProof? proof, HttpContext http, CancellationToken ct)
    {
        if (plugins.TryAcquireService<ICaptchaVerification>(out var lease))
        {
            await using (lease) await lease.Service.Verify(proof, http, ct);
            return;
        }
        await RequireUnavailable(ct);
    }
}

public sealed class ReloadableConverter(PluginRuntime plugins) : IPresentationConverter
{
    public bool Available
    {
        get { if (!plugins.TryAcquireService<IPresentationConverter>(out var lease)) return false; using (lease) return lease.Service.Available; }
    }
    public string? Command
    {
        get { if (!plugins.TryAcquireService<IPresentationConverter>(out var lease)) return null; using (lease) return lease.Service.Command; }
    }
    public async Task<string?> ConvertToPdf(string inputPath, string workDirectory, CancellationToken ct)
    {
        if (!plugins.TryAcquireService<IPresentationConverter>(out var lease)) return null;
        await using (lease) return await lease.Service.ConvertToPdf(inputPath, workDirectory, ct);
    }
}

public sealed class ReloadableMemberPermissions(PluginRuntime plugins) : IMemberPermissionVerifier
{
    public async Task<bool> HasPermission(string permission, CancellationToken ct)
    {
        if (!plugins.TryAcquireService<IMemberPermissionVerifier>(out var lease)) return false;
        await using (lease) return await lease.Service.HasPermission(permission, ct);
    }
    public async Task RequirePermission(string permission, CancellationToken ct)
    {
        if (!await HasPermission(permission, ct)) throw ApiException.Forbidden();
    }
}

public sealed class PluginPermissionSync(PluginRuntime plugins, IServiceProvider services, IConfiguration configuration, IHostEnvironment environment, ILogger<PluginPermissionSync> logger) : BackgroundService
{
    private readonly Channel<bool> changes = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        void Changed() => changes.Writer.TryWrite(true);
        plugins.Changed += Changed;
        try
        {
            await foreach (var _ in changes.Reader.ReadAllAsync(stoppingToken))
            {
                try { await DatabaseBootstrap.Initialize(services, configuration, environment, stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception exception) { logger.LogError(exception, "Could not synchronize permissions after a plugin update"); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { plugins.Changed -= Changed; }
    }
}
