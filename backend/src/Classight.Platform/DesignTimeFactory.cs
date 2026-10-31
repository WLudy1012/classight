using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Classight.Platform;

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var provider = Environment.GetEnvironmentVariable("CLASSIGHT_DB_PROVIDER") ?? "PostgreSql";
        var connection = Environment.GetEnvironmentVariable("CLASSIGHT_DB_CONNECTION") ?? (provider == "MySql" ? "Server=localhost;Database=classight;User=root;Password=change-me" : "Host=localhost;Database=classight;Username=postgres;Password=change-me");
        var options = new DbContextOptionsBuilder<AppDbContext>();
        if (provider == "MySql") options.UseMySql(connection, new MySqlServerVersion(new Version(8, 0, 36)));
        else options.UseNpgsql(connection);
        return new AppDbContext(options.Options);
    }
}
