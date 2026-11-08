using Classight.Identity;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.EntityFrameworkCore;

namespace Classight.Api;

public static class DatabaseBootstrap
{
    private static readonly string[] AdminExtras = ["content.manage", "users.read", "users.manage", "invites.manage", "site.settings.read", "audit.read", "speech.participate", "speech.manage", "timetable.manage"];

    /// <summary>The permissions a built-in role gets by default. SuperAdmin always receives everything.</summary>
    public static bool Default(string role, string code) =>
        role == "SuperAdmin" || code == "media.upload" || code == "speech.participate"
        || role == "Admin" && (code.StartsWith("class.") || AdminExtras.Contains(code));

    /// <summary>Creates the schema, built-in roles, default settings and (when a Bootstrap password is configured) the first administrator.
    /// Does nothing until a database is configured, so a fresh install can reach the setup wizard.</summary>
    public static async Task Initialize(IServiceProvider services, IConfiguration config, IHostEnvironment environment, CancellationToken ct)
    {
        var database = services.GetRequiredService<DatabaseConfig>();
        if (!database.Configured) return;
        var log = services.GetRequiredService<ILoggerFactory>().CreateLogger("Bootstrap");
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ensureCreated = database.Provider == "MySql" && database.AutoMigrate || database.Provider == "Sqlite" && database.AllowSqlite;
        if (ensureCreated)
        {
            await db.Database.EnsureCreatedAsync(ct);
            // EnsureCreated does nothing for a database that already has tables, so tables added by newer versions are missing there.
            try { _ = await db.MeetingSessions.AsNoTracking().AnyAsync(ct); }
            catch (Exception ex) { log.LogError(ex, "The database predates the speech-queue tables and EnsureCreated cannot add them. Recreate the database (development) or add the tables manually."); throw; }
        }
        else if (database.AutoMigrate) await db.Database.MigrateAsync(ct);

        var catalog = scope.ServiceProvider.GetRequiredService<IPermissionCatalog>();
        var codes = catalog.All.Select(x => x.Code).ToArray();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var system = await SystemState.Read(db, ct);
        // Databases from before permission tracking already hold every code except the speech ones.
        var seeded = (system?.SeededPermissions ?? (system is null && !await db.Roles.AnyAsync(ct) ? Array.Empty<string>() : codes.Where(x => !x.StartsWith("speech.")).ToArray())).ToHashSet();
        var builtIn = new[] { "Member", "Admin", "SuperAdmin" };
        var existing = await db.Roles.Where(x => builtIn.Contains(x.Name) && !x.Deleted).ToListAsync(ct);
        foreach (var name in builtIn)
        {
            var role = existing.SingleOrDefault(x => x.Name == name);
            if (role is null) { db.Roles.Add(new Role { Name = name, Description = name, BuiltIn = true, Permissions = codes.Where(x => Default(name, x)).ToArray() }); continue; }
            var missing = codes.Where(x => !seeded.Contains(x) && Default(name, x) && !role.Permissions.Contains(x)).ToArray();
            if (missing.Length > 0) role.Permissions = role.Permissions.Concat(missing).ToArray();
        }
        var defaults = new Dictionary<string, object> { ["site"] = new SiteSettings(), ["appearance"] = new AppearanceSettings(), ["security"] = new SecuritySettings(), ["storage"] = new StorageSettings(), ["speech"] = new SpeechSettings() };
        foreach (var (group, value) in defaults) if (!await db.Settings.AnyAsync(x => x.Group == group, ct)) db.Settings.Add(new Setting { Group = group, Json = JsonDefaults.Serialize(value) });
        if (!await db.ClassProfiles.AnyAsync(ct)) db.ClassProfiles.Add(new ClassProfile());
        await db.SaveChangesAsync(ct);
        await SystemState.Update(db, d => d.SeededPermissions = seeded.Union(codes).ToArray(), ct);

        if (!await db.Users.AnyAsync(ct) && config["Bootstrap:Password"] is { Length: > 0 } password)
        {
            var identity = scope.ServiceProvider.GetRequiredService<IdentityService>(); var role = await db.Roles.SingleAsync(x => x.Name == "SuperAdmin", ct);
            await identity.NewUser(config["Bootstrap:Username"] ?? "admin", "Administrator", password, null, [role], ct); await db.SaveChangesAsync(ct);
            await SystemState.WriteSetupCompleted(db, true, ct); // a preset administrator means the operator configured the server by hand
        }
        await transaction.CommitAsync(ct);
    }
}
