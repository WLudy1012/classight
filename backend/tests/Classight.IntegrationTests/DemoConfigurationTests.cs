using Classight.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class DemoConfigurationTests
{
    [Theory]
    [InlineData("Production", false, false)]
    [InlineData("Production", true, true)]
    [InlineData("Development", false, true)]
    [InlineData("Testing", false, true)]
    public void Embedded_database_is_available_for_the_explicit_demo_configuration(string environment, bool demo, bool allowed)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Demo:Enabled"] = demo.ToString(), ["Database:Provider"] = "Sqlite", ["ConnectionStrings:Main"] = "Data Source=:memory:"
        }).Build();
        var database = new DatabaseConfig(configuration, new Environment(environment));
        Assert.Equal(allowed, database.AllowSqlite);
        var options = new DbContextOptionsBuilder<AppDbContext>();
        if (allowed) database.Configure(options);
        else Assert.Throws<InvalidOperationException>(() => database.Configure(options));
    }

    private sealed class Environment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Classight.Demo.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
