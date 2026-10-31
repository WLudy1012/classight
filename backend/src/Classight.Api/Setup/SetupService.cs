using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Classight.Platform;
using Classight.SharedKernel;
using Classight.Speech;
using Microsoft.EntityFrameworkCore;

namespace Classight.Api.Setup;

public record DatabaseTestRequest(string? Provider, string? ConnectionString);
public record SetupAdminRequest(string? Username, string? DisplayName, string? Password, string? Email);

/// <summary>
/// First-run state machine: needs_database → needs_admin → ready. Once the state is "ready" and setup is completed it is cached
/// for the process lifetime, so the gate costs nothing after the wizard has been finished.
/// </summary>
public sealed class SetupService(IServiceProvider services, DatabaseConfig database, IJwtKeyProvider jwtKeys, IConfiguration config, IHostEnvironment environment, IPresentationConverter converter, ILogger<SetupService> logger)
{
    private volatile bool readyCached;
    private volatile bool completedCached;
    private volatile string? bootstrapError;
    private string token = "";
    private readonly SemaphoreSlim applyLock = new(1, 1);

    public string LocalConfigPath => config["Setup:LocalConfigPath"] ?? Path.Combine(environment.ContentRootPath, "appsettings.Local.json");
    public string TokenPath => config["Setup:TokenPath"] ?? Path.Combine(environment.ContentRootPath, "data", "setup-token.txt");
    public string StoragePath => Path.GetFullPath(config["Storage:LocalPath"] ?? "data/media", environment.ContentRootPath);

    public void SetBootstrapError(string? message) => bootstrapError = message;

    /// <summary>Generates the one-time token (printed and written to disk) unless the wizard has already been completed.</summary>
    public async Task Prepare(CancellationToken ct)
    {
        var status = await GetStatus(ct);
        if (status.SetupCompleted) { TryDeleteTokenFile(); return; }
        token = config["Setup:Token"] is { Length: >= 8 } fixedToken ? fixedToken : Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(TokenPath)!);
            await File.WriteAllTextAsync(TokenPath, token, ct);
        }
        catch (Exception ex) { logger.LogWarning(ex, "Could not write the setup token file"); }
        logger.LogWarning("First-run setup is pending. Open the web app and enter the setup token: {Token}  (also in {Path})", token, TokenPath);
    }

    private void TryDeleteTokenFile() { try { if (File.Exists(TokenPath)) File.Delete(TokenPath); } catch { /* best effort */ } }

    public void RequireToken(HttpContext http)
    {
        if (completedCached) throw Forbidden("系统已完成初始化");
        var given = http.Request.Headers["X-Setup-Token"].ToString();
        if (token.Length == 0 || given.Length == 0 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(token))) throw Forbidden("Setup Token 无效");
    }
    public static ApiException Forbidden(string message) => new(403, "setup.forbidden", message);

    public async Task<bool> IsReady(CancellationToken ct) => readyCached || (await GetStatus(ct)).State == "ready";

    public async Task<SetupStatusView> GetStatus(CancellationToken ct)
    {
        var provider = database.Provider ?? "PostgreSql";
        string state = "needs_database"; bool connected = false, completed = false; string? error = bootstrapError;
        if (database.Configured)
        {
            try
            {
                await using var scope = services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                connected = await db.Database.CanConnectAsync(ct);
                if (connected)
                {
                    var schemaReady = await SchemaReady(db, ct);
                    if (!schemaReady) { connected = true; state = "needs_database"; error ??= "数据库已连接，但尚未初始化表结构"; }
                    else
                    {
                        var hasUsers = await db.Users.AnyAsync(ct);
                        var flag = await SystemState.ReadSetupCompleted(db, ct);
                        completed = flag ?? hasUsers; // databases created before the wizard existed count as completed
                        state = hasUsers ? "ready" : "needs_admin";
                        error = null;
                    }
                }
                else error ??= "无法连接到数据库";
            }
            catch (Exception ex) { logger.LogWarning(ex, "Setup status check failed"); error ??= "无法连接到数据库"; connected = false; }
        }
        if (state == "ready") { readyCached = true; if (completed) completedCached = true; }
        var (writable, path) = StorageProbe();
        return new SetupStatusView(state, completed, !completed && state != "ready",
            new(provider, database.Configured, connected, error), new(path, writable), new(converter.Available, converter.Command),
            jwtKeys.IsDefault, environment.EnvironmentName, "1.0.0", database.AllowSqlite);
    }

    private static async Task<bool> SchemaReady(AppDbContext db, CancellationToken ct)
    {
        try { _ = await db.Roles.AsNoTracking().AnyAsync(ct); return true; } catch { return false; }
    }

    private (bool Writable, string Path) StorageProbe()
    {
        var path = StoragePath;
        try
        {
            Directory.CreateDirectory(path);
            var probe = Path.Combine(path, $".probe-{Guid.NewGuid():N}");
            File.WriteAllText(probe, "ok"); File.Delete(probe);
            return (true, path);
        }
        catch { return (false, path); }
    }

    public static string Normalize(string? provider, bool allowSqlite)
    {
        var value = provider?.Trim();
        if (value is "PostgreSql" or "MySql") return value;
        if (value == "Sqlite") return allowSqlite ? value : throw new ApiException(422, "setup.database_unreachable", "当前运行环境不允许使用 SQLite，请选择 PostgreSQL 或 MySQL");
        throw ApiException.Validation("provider", "数据库类型须为 PostgreSql、MySql 或 Sqlite");
    }

    /// <summary>Opens a throw-away context. Errors are reduced to a generic message: the connection string may contain the password.</summary>
    public async Task<(string Message, string? ServerVersion)> TestConnection(string provider, string connectionString, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(connectionString) || connectionString.Length > 2000) throw ApiException.Validation("connectionString", "连接字符串不能为空");
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>();
            DatabaseConfig.Apply(options, provider, connectionString, database.AllowSqlite);
            await using var probe = new AppDbContext(options.Options);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(10));
            // EF's CanConnect reports false for a SQLite file that does not exist yet, but initialisation creates it: open the connection instead.
            if (provider == "Sqlite") await probe.Database.OpenConnectionAsync(timeout.Token);
            else if (!await probe.Database.CanConnectAsync(timeout.Token)) throw new InvalidOperationException("cannot connect");
            string? version = null;
            try
            {
                var connection = probe.Database.GetDbConnection(); await connection.OpenAsync(timeout.Token);
                version = connection.ServerVersion; await connection.CloseAsync();
            }
            catch { /* the version is informational */ }
            return ("连接成功", version);
        }
        catch (ApiException) { throw; }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogInformation("Setup database test failed: {Type}", ex.GetType().Name);
            throw new ApiException(422, "setup.database_unreachable", Describe(ex));
        }
    }

    private static IEnumerable<Exception> Chain(Exception? ex) { for (; ex is not null; ex = ex.InnerException) yield return ex; }

    private static string Describe(Exception ex)
    {
        var text = string.Join(" | ", Chain(ex).Select(e => e.Message));
        if (ex is OperationCanceledException || text.Contains("timeout", StringComparison.OrdinalIgnoreCase) || text.Contains("timed out", StringComparison.OrdinalIgnoreCase)) return "连接超时，请检查主机地址与端口";
        if (text.Contains("password", StringComparison.OrdinalIgnoreCase) || text.Contains("authentication", StringComparison.OrdinalIgnoreCase) || text.Contains("Access denied", StringComparison.OrdinalIgnoreCase)) return "数据库拒绝了用户名或密码";
        if (text.Contains("does not exist", StringComparison.OrdinalIgnoreCase) || text.Contains("Unknown database", StringComparison.OrdinalIgnoreCase)) return "数据库不存在，请先创建空数据库";
        if (text.Contains("host", StringComparison.OrdinalIgnoreCase) || text.Contains("refused", StringComparison.OrdinalIgnoreCase) || text.Contains("No such host", StringComparison.OrdinalIgnoreCase)) return "无法连接到数据库服务器，请检查主机地址与端口";
        return "无法连接到数据库，请检查连接字符串";
    }

    /// <summary>Applies a tested configuration: persists it, swaps the live settings, rotates a default JWT key, migrates and seeds.</summary>
    public async Task<SetupStatusView> ApplyDatabase(string provider, string connectionString, CancellationToken ct)
    {
        await applyLock.WaitAsync(ct);
        try
        {
            var current = await GetStatus(ct);
            if (current.State != "needs_database") throw Forbidden("数据库已经配置完成");
            await TestConnection(provider, connectionString, ct);
            var newKey = jwtKeys.IsDefault ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)) : null;
            var previous = database.Snapshot();
            database.Set(provider, connectionString, true);
            try { await DatabaseBootstrap.Initialize(services, config, environment, ct); }
            catch (Exception ex)
            {
                database.Set(previous.Provider, previous.Connection, previous.AutoMigrate);
                logger.LogError(ex, "Applying the database configuration failed");
                throw new ApiException(422, "setup.database_unreachable", "数据库已连接，但初始化表结构失败，请确认账号拥有建表权限");
            }
            PersistLocalConfig(provider, connectionString, newKey);
            if (newKey is not null) jwtKeys.Replace(newKey);
            bootstrapError = null;
            return await GetStatus(ct);
        }
        finally { applyLock.Release(); }
    }

    private void PersistLocalConfig(string provider, string connectionString, string? jwtKey)
    {
        var path = LocalConfigPath;
        JsonObject root;
        try { root = File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path))?.AsObject() ?? new JsonObject() : new JsonObject(); }
        catch (JsonException) { root = new JsonObject(); }
        var db = root["Database"] as JsonObject ?? new JsonObject(); db["Provider"] = provider; db["AutoMigrate"] = true; root["Database"] = db;
        var cs = root["ConnectionStrings"] as JsonObject ?? new JsonObject(); cs["Main"] = connectionString; root["ConnectionStrings"] = cs;
        if (jwtKey is not null) { var jwt = root["Jwt"] as JsonObject ?? new JsonObject(); jwt["Key"] = jwtKey; root["Jwt"] = jwt; }
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    public async Task Complete(CancellationToken ct)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await SystemState.WriteSetupCompleted(db, true, ct);
        completedCached = true; readyCached = true;
        token = ""; TryDeleteTokenFile();
    }
}

public record DatabaseView(string Provider, bool Configured, bool Connected, string? Error);
public record StorageView(string Path, bool Writable);
public record ConverterView(bool Available, string? Command);
public record SetupStatusView(string State, bool SetupCompleted, bool TokenRequired, DatabaseView Database, StorageView Storage, ConverterView Converter, bool JwtKeyIsDefault, string Environment, string Version, bool SqliteAllowed);
