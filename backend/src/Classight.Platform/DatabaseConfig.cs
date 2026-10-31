using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Classight.Platform;

/// <summary>Runtime-replaceable database settings. The setup wizard swaps the provider and connection string without a restart.</summary>
public sealed class DatabaseConfig(IConfiguration config, IHostEnvironment environment)
{
    private readonly object gate = new();
    // Read lazily: host configuration (including test overrides) is only complete after the host is built.
    private (string? Provider, string? Connection, bool AutoMigrate)? state;
    private (string? Provider, string? Connection, bool AutoMigrate) Current => state ??= (config["Database:Provider"], config.GetConnectionString("Main"), config.GetValue<bool>("Database:AutoMigrate"));
    public string? Provider { get { lock (gate) return Current.Provider; } }
    public string? ConnectionString { get { lock (gate) return Current.Connection; } }
    public bool AutoMigrate { get { lock (gate) return Current.AutoMigrate; } }
    public bool Configured { get { lock (gate) return !string.IsNullOrWhiteSpace(Current.Provider) && !string.IsNullOrWhiteSpace(Current.Connection); } }
    public bool AllowSqlite => environment.IsDevelopment() || environment.IsEnvironment("Testing");
    public (string? Provider, string? Connection, bool AutoMigrate) Snapshot() { lock (gate) return Current; }
    public void Set(string? provider, string? connection, bool autoMigrate) { lock (gate) state = (provider, connection, autoMigrate); }
    public void Configure(DbContextOptionsBuilder options)
    {
        var (provider, connection, _) = Snapshot();
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("The database is not configured.");
        Apply(options, provider, connection, AllowSqlite);
    }
    public static void Apply(DbContextOptionsBuilder options, string? provider, string connection, bool allowSqlite)
    {
        switch (provider)
        {
            case "PostgreSql": options.UseNpgsql(connection); break;
            case "MySql": options.UseMySql(connection, new MySqlServerVersion(new Version(8, 0, 36))); break;
            case "Sqlite" when allowSqlite:
                var file = new SqliteConnectionStringBuilder(connection).DataSource;
                if (!string.IsNullOrEmpty(file) && file != ":memory:" && Path.GetDirectoryName(Path.GetFullPath(file)) is { Length: > 0 } directory) Directory.CreateDirectory(directory);
                options.UseSqlite(connection); break;
            default: throw new InvalidOperationException("Database:Provider must be PostgreSql or MySql. Sqlite is restricted to development/tests.");
        }
    }
}

/// <summary>Direct access to the hidden "system" settings row (never exposed through the settings API).</summary>
public static class SystemState
{
    public const string Group = "system";
    public static readonly string[] PublicGroups = ["site", "appearance", "security", "storage", "speech"];
    public sealed class Doc
    {
        public bool SetupCompleted { get; set; }
        /// <summary>Permission codes already granted to the built-in roles; new codes are back-filled once, so a permission an administrator removed later is not re-added.</summary>
        public string[]? SeededPermissions { get; set; }
    }
    public static async Task<Doc?> Read(AppDbContext db, CancellationToken ct)
    {
        var row = await db.Settings.AsNoTracking().SingleOrDefaultAsync(x => x.Group == Group, ct);
        if (row is null) return null;
        try { return System.Text.Json.JsonSerializer.Deserialize<Doc>(row.Json, JsonDefaults.Options) ?? new Doc(); } catch { return new Doc(); }
    }
    public static async Task Update(AppDbContext db, Action<Doc> change, CancellationToken ct)
    {
        var row = await db.Settings.SingleOrDefaultAsync(x => x.Group == Group, ct);
        Doc doc;
        try { doc = row is null ? new Doc() : System.Text.Json.JsonSerializer.Deserialize<Doc>(row.Json, JsonDefaults.Options) ?? new Doc(); } catch { doc = new Doc(); }
        change(doc);
        var json = JsonDefaults.Serialize(doc);
        if (row is null) db.Settings.Add(new Setting { Group = Group, Json = json }); else row.Json = json;
        await db.SaveChangesAsync(ct);
    }
    public static async Task<bool?> ReadSetupCompleted(AppDbContext db, CancellationToken ct) => (await Read(db, ct))?.SetupCompleted;
    public static Task WriteSetupCompleted(AppDbContext db, bool completed, CancellationToken ct) => Update(db, d => d.SetupCompleted = completed, ct);
}
