using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Classight.IntegrationTests;

/// <summary>A deployment that has never been configured: no database, no Bootstrap password, fixed setup token.</summary>
public sealed class SetupFactory : WebApplicationFactory<Program>
{
    public const string Token = "test-setup-token-123";
    private readonly string root = Path.Combine(Path.GetTempPath(), "classight-setup-" + Guid.NewGuid().ToString("N"));

    public string Root => root;
    public string TokenPath => Path.Combine(root, "setup-token.txt");
    public string LocalConfigPath => Path.Combine(root, "appsettings.Local.json");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(root);
        builder.UseEnvironment("Testing");
        // appsettings.json ships a PostgreSQL provider, a connection string and a Bootstrap password; a fresh install has none of them.
        // Jwt:Key is pinned to the development default so a developer's appsettings.Local.json (written by a real setup run) cannot change the outcome.
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Database:Provider"] = null, ["ConnectionStrings:Main"] = null, ["Bootstrap:Username"] = null, ["Bootstrap:Password"] = null,
            ["Jwt:Key"] = Classight.SharedKernel.JwtKeyProvider.DevelopmentDefault,
            ["Setup:LocalConfigPath"] = LocalConfigPath, ["Setup:TokenPath"] = TokenPath, ["Setup:Token"] = Token,
            ["Storage:LocalPath"] = Path.Combine(root, "media"),
            ["Plugins:Directory"] = Path.Combine(root, "plugin"),
            ["Jwt:Issuer"] = "classight", ["Jwt:Audience"] = "classight-web",
            ["RateLimit:AuthPerMinute"] = "1000", ["RateLimit:GeneralPerMinute"] = "10000"
        }));
    }

    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false, AllowAutoRedirect = false });

    public HttpClient WithSetupToken(string token = Token)
    {
        var client = Client(); client.DefaultRequestHeaders.Add("X-Setup-Token", token); return client;
    }

    public HttpClient AsBearer(string accessToken)
    {
        var client = Client(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken); return client;
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public sealed class SetupTests
{
    private const string AdminPassword = "SetupAdminPass123!";

    [Fact]
    public async Task Status_is_public_and_exposes_no_secrets()
    {
        await using var setup = new SetupFactory();
        using var client = setup.Client();
        var response = await client.GetAsync("/api/v1/setup/status");
        var text = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var status = JsonDocument.Parse(text).RootElement;
        Assert.Equal("needs_database", status.GetProperty("state").GetString());
        Assert.False(status.GetProperty("setupCompleted").GetBoolean());
        Assert.True(status.GetProperty("tokenRequired").GetBoolean());
        Assert.True(status.GetProperty("jwtKeyIsDefault").GetBoolean());
        Assert.True(status.GetProperty("sqliteAllowed").GetBoolean());
        Assert.True(File.Exists(setup.TokenPath));

        Assert.DoesNotContain("connectionString", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Until_setup_is_ready_the_api_answers_503_except_health_and_setup()
    {
        await using var setup = new SetupFactory();
        using var client = setup.Client();
        await Kit.Problem(await client.GetAsync("/api/v1/site/public"), HttpStatusCode.ServiceUnavailable, "setup.required");
        await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "whatever" }), HttpStatusCode.ServiceUnavailable, "setup.required");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [Fact]
    public async Task Wizard_endpoints_require_the_setup_token()
    {
        await using var setup = new SetupFactory();
        using var anonymous = setup.Client();
        var body = new { provider = "Sqlite", connectionString = "Data Source=unused.db" };
        await Kit.Problem(await anonymous.PostAsJsonAsync("/api/v1/setup/database/test", body), HttpStatusCode.Forbidden, "setup.forbidden");

        using var wrong = setup.WithSetupToken("not-the-token");
        await Kit.Problem(await wrong.PostAsJsonAsync("/api/v1/setup/database/test", body), HttpStatusCode.Forbidden, "setup.forbidden");
    }

    [Fact]
    public async Task Unreachable_database_is_reported_without_leaking_the_connection_string()
    {
        await using var setup = new SetupFactory();
        using var wizard = setup.WithSetupToken();
        var response = await wizard.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "PostgreSql", connectionString = "Host=127.0.0.1;Port=1;Database=x;Username=u;Password=SECRETPW;Timeout=2" });
        var text = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("setup.database_unreachable", JsonDocument.Parse(text).RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("SECRETPW", text, StringComparison.Ordinal);
        Assert.DoesNotContain("127.0.0.1", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Host=", text, StringComparison.Ordinal);

        await Kit.Problem(await wizard.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "Oracle", connectionString = "Data Source=x" }), HttpStatusCode.BadRequest, "validation.failed");
    }

    [Fact]
    public async Task Wizard_configures_the_database_creates_the_admin_and_completes_setup()
    {
        await using var setup = new SetupFactory();
        using var anonymous = setup.Client();
        using var wizard = setup.WithSetupToken();
        // An existing (empty) file: EF's CanConnect reports a missing SQLite file as unreachable, see Wizard_accepts_a_brand_new_sqlite_file.
        var databaseFile = Path.Combine(setup.Root, "wizard.db");
        await File.WriteAllBytesAsync(databaseFile, Array.Empty<byte>());
        var connection = "Data Source=" + databaseFile;

        var initial = await Kit.Json(await anonymous.GetAsync("/api/v1/setup/status"));
        Assert.Equal("needs_database", initial.GetProperty("state").GetString());
        Assert.True(initial.GetProperty("tokenRequired").GetBoolean());

        await Kit.Json(await wizard.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "Sqlite", connectionString = connection }));
        var applied = await Kit.Json(await wizard.PostAsJsonAsync("/api/v1/setup/database", new { provider = "Sqlite", connectionString = connection }));
        Assert.Equal("needs_admin", applied.GetProperty("state").GetString());
        Assert.True(applied.GetProperty("database").GetProperty("connected").GetBoolean());
        Assert.False(applied.GetProperty("jwtKeyIsDefault").GetBoolean());

        var local = JsonDocument.Parse(await File.ReadAllTextAsync(setup.LocalConfigPath)).RootElement;
        Assert.Equal("Sqlite", local.GetProperty("Database").GetProperty("Provider").GetString());
        Assert.Equal(connection, local.GetProperty("ConnectionStrings").GetProperty("Main").GetString());
        Assert.True(local.GetProperty("Jwt").GetProperty("Key").GetString()!.Length >= 32);

        // Still unfinished: the gate stays closed until an administrator exists.
        await Kit.Problem(await anonymous.GetAsync("/api/v1/site/public"), HttpStatusCode.ServiceUnavailable, "setup.required");

        var admin = await Kit.Json(await wizard.PostAsJsonAsync("/api/v1/setup/admin", new { username = "owner", displayName = "班主任", password = AdminPassword }));
        var accessToken = admin.GetProperty("accessToken").GetString()!;
        var permissions = admin.GetProperty("user").GetProperty("permissions").EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Contains("speech.manage", permissions);
        Assert.Contains("system.manage", permissions);

        var ready = await Kit.Json(await anonymous.GetAsync("/api/v1/setup/status"));
        Assert.Equal("ready", ready.GetProperty("state").GetString());
        Assert.False(ready.GetProperty("setupCompleted").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/api/v1/site/public")).StatusCode);

        // The token was signed with the freshly generated key, so it must validate after the swap.
        using var owner = setup.AsBearer(accessToken);
        await Kit.Json(await owner.GetAsync("/api/v1/admin/settings/site"));

        await Kit.Problem(await wizard.PostAsJsonAsync("/api/v1/setup/admin", new { username = "second", displayName = "second", password = AdminPassword }), HttpStatusCode.Forbidden, "setup.forbidden");
        await Kit.Problem(await wizard.PostAsJsonAsync("/api/v1/setup/database", new { provider = "Sqlite", connectionString = connection }), HttpStatusCode.Forbidden, "setup.forbidden");

        await Kit.Problem(await anonymous.PostAsync("/api/v1/setup/complete", null), HttpStatusCode.Unauthorized, "auth.token_invalid");
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsync("/api/v1/setup/complete", null)).StatusCode);

        var done = await Kit.Json(await anonymous.GetAsync("/api/v1/setup/status"));
        Assert.True(done.GetProperty("setupCompleted").GetBoolean());
        Assert.False(done.GetProperty("tokenRequired").GetBoolean());
        Assert.False(File.Exists(setup.TokenPath));

        await Kit.Problem(await wizard.PostAsJsonAsync("/api/v1/setup/admin", new { username = "third", displayName = "third", password = AdminPassword }), HttpStatusCode.Forbidden, "setup.forbidden");
        await Kit.Problem(await wizard.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "Sqlite", connectionString = connection }), HttpStatusCode.Forbidden, "setup.forbidden");
    }

    /// <summary>Contract S3: the wizard's SQLite path is a database to be created by setup. Known src bug: TestConnection uses CanConnectAsync, which is false for a file that does not exist yet.</summary>
    [Fact]
    public async Task Wizard_accepts_a_brand_new_sqlite_file()
    {
        await using var setup = new SetupFactory();
        using var wizard = setup.WithSetupToken();
        var connection = "Data Source=" + Path.Combine(setup.Root, "fresh.db");
        var tested = await Kit.Json(await wizard.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "Sqlite", connectionString = connection }));
        Assert.True(tested.GetProperty("ok").GetBoolean());

        var applied = await Kit.Json(await wizard.PostAsJsonAsync("/api/v1/setup/database", new { provider = "Sqlite", connectionString = connection }));
        Assert.Equal("needs_admin", applied.GetProperty("state").GetString());
        Assert.True(File.Exists(Path.Combine(setup.Root, "fresh.db")));
    }

    [Fact]
    public async Task Existing_deployment_with_a_bootstrap_password_is_already_complete()
    {
        await using var app = new ApiFactory();
        using var client = app.Client();
        var status = await Kit.Json(await client.GetAsync("/api/v1/setup/status"));
        Assert.Equal("ready", status.GetProperty("state").GetString());
        Assert.True(status.GetProperty("setupCompleted").GetBoolean());

        await Kit.Problem(await client.PostAsJsonAsync("/api/v1/setup/database/test", new { provider = "Sqlite", connectionString = "Data Source=whatever.db" }), HttpStatusCode.Forbidden, "setup.forbidden");
    }
}
