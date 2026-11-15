using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Platform;

public static class PluginDatabase
{
    public static void AddPluginDatabase<T>(this IServiceCollection services, Func<DbContextOptions<T>, T> create, Func<string?, string[]> schema) where T : DbContext
    {
        var initializer = new Schema<T>(schema);
        services.AddSingleton(initializer);
        services.AddScoped(sp =>
        {
            var settings = sp.GetRequiredService<DatabaseConfig>();
            var (provider, connection, _) = settings.Snapshot();
            var options = new DbContextOptionsBuilder<T>();
            DatabaseConfig.Apply(options, provider, connection ?? throw new InvalidOperationException("The database is not configured."), settings.AllowSqlite);
            options.EnableServiceProviderCaching(false);
            return create(options.Options);
        });
    }

    public sealed class Schema<T>(Func<string?, string[]> statements) where T : DbContext
    {
        private readonly SemaphoreSlim gate = new(1);
        private volatile string? initialized;

        public async Task Ensure(T db, CancellationToken ct)
        {
            var provider = db.Database.ProviderName;
            var target = provider + "\n" + db.Database.GetConnectionString();
            if (initialized == target) return;
            await gate.WaitAsync(ct);
            try
            {
                if (initialized == target) return;
                foreach (var statement in statements(provider)) await db.Database.ExecuteSqlRawAsync(statement, ct);
                initialized = target;
            }
            finally { gate.Release(); }
        }
    }
}
