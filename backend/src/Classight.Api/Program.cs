using System.Security.Claims;
using System.Text;
using Classight.Api;
using Classight.Api.Setup;
using Classight.Class;
using Classight.Content;
using Classight.Contracts;
using Classight.Identity;
using Classight.Platform;
using Classight.SharedKernel;
using Classight.SiteAdmin;
using Classight.Speech;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Bson.Serialization.Serializers;
using MongoDB.Driver;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
// A developer's appsettings.Local.json (written by a real setup run) must never leak into the test environment.
if (!builder.Environment.IsEnvironment("Testing")) builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true);
builder.Configuration.AddEnvironmentVariables();
var key = builder.Configuration["Jwt:Key"];
if (key is null || Encoding.UTF8.GetByteCount(key) < 32)
{
    // A fresh install (no database configured yet) must still boot so the setup wizard can run: it falls back to the
    // development default key, which the wizard replaces with a generated secret persisted to appsettings.Local.json.
    // A deployment whose database is already configured but has no key is an operator error and must fail loudly.
    var databaseConfigured = !string.IsNullOrWhiteSpace(builder.Configuration["Database:Provider"]) && !string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Main"));
    if (databaseConfigured) throw new InvalidOperationException("Set Jwt__Key to a random secret of at least 32 bytes.");
    Console.WriteLine("WARNING: Jwt:Key is not configured; using the development default until the setup wizard persists a permanent key to appsettings.Local.json.");
    key = JwtKeyProvider.DevelopmentDefault;
}
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 21 * 1024 * 1024);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 21 * 1024 * 1024);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpForwarder();
builder.Services.AddSingleton<FrontendProxy>();
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
// The database settings and the JWT key live in runtime-replaceable singletons so the first-run wizard can configure them without a restart.
builder.Services.AddSingleton(new DatabaseConfig(builder.Configuration, builder.Environment));
var jwtKeys = new JwtKeyProvider(key);
builder.Services.AddSingleton<IJwtKeyProvider>(jwtKeys);
builder.Services.AddDbContext<AppDbContext>((services, options) => services.GetRequiredService<DatabaseConfig>().Configure(options));
builder.Services.AddScoped<PluginStateStore>();
builder.Services.AddSingleton<SetupService>();
if (builder.Configuration.GetValue<bool>("Redis:Enabled"))
{
    var connection = builder.Configuration.GetConnectionString("Redis") ?? throw new InvalidOperationException("Set ConnectionStrings__Redis.");
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(connection));
    builder.Services.AddStackExchangeRedisCache(options => { options.Configuration = connection; options.InstanceName = "classight:"; });
    builder.Services.AddSingleton<IDistributedLock, RedisLock>(); builder.Services.AddSingleton<IRateLimitStore, RedisRateLimitStore>();
}
else { builder.Services.AddSingleton<IDistributedLock, LocalLock>(); builder.Services.AddSingleton<IRateLimitStore, LocalRateLimitStore>(); }
builder.Services.AddHybridCache(); builder.Services.AddSingleton<ICacheService, CacheService>();
if (builder.Configuration.GetValue<bool>("Mongo:Enabled"))
{
    BsonSerializer.TryRegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
    builder.Services.AddSingleton<IMongoDatabase>(_ => new MongoClient(builder.Configuration.GetConnectionString("Mongo") ?? throw new InvalidOperationException("Set ConnectionStrings__Mongo.")).GetDatabase(builder.Configuration["Mongo:Database"]));
    builder.Services.AddScoped<IAuditStore, MongoAuditStore>(); builder.Services.AddScoped<IActivityStore, MongoActivityStore>();
}
else { builder.Services.AddScoped<IAuditStore, RelationalAuditStore>(); builder.Services.AddScoped<IActivityStore, RelationalActivityStore>(); }
builder.Services.AddScoped<IEventBus, EventBus>(); builder.Services.AddScoped<IEventHandler, AuditEventHandler>(); builder.Services.AddScoped<IEventHandler, CacheEventHandler>();
builder.Services.AddSingleton<IMediaStorage, LocalMediaStorage>(); builder.Services.AddSingleton<IEmailSender, NoopEmailSender>(); builder.Services.AddScoped<INotificationDispatcher, NotificationDispatcher>();
IModule[] modules = [new IdentityModule(), new ClassModule(), new MemberIdentityModule(), new TimetableModule(), new ContentModule(), new SiteAdminModule(), new SpeechModule()];
var catalog = new PermissionCatalog(modules); builder.Services.AddSingleton<IPermissionCatalog>(catalog);
foreach (var module in modules) module.AddServices(builder.Services, builder.Configuration);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true, ValidIssuer = builder.Configuration["Jwt:Issuer"], ValidAudience = builder.Configuration["Jwt:Audience"], IssuerSigningKeyResolver = (_, _, _, _) => [new SymmetricSecurityKey(jwtKeys.KeyBytes)], ClockSkew = TimeSpan.FromSeconds(10), ValidAlgorithms = [SecurityAlgorithms.HmacSha256] };
    options.Events = new JwtBearerEvents
    {
        OnAuthenticationFailed = context =>
        {
            context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Jwt").LogWarning(context.Exception, "JWT authentication failed");
            return Task.CompletedTask;
        },
        OnTokenValidated = async context =>
        {
            var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Jwt");
            var current = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>(); var clock = context.HttpContext.RequestServices.GetRequiredService<IClock>();
            var userId = Guid.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Principal?.FindFirstValue("sub"), out var uid) ? uid : Guid.Empty;
            var sessionId = Guid.TryParse(context.Principal?.FindFirstValue("sid"), out var sid) ? sid : Guid.Empty;
            var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sessionId && x.UserId == userId, context.HttpContext.RequestAborted);
            if (session is null || session.Revoked || session.ExpiresAt <= clock.UtcNow) { logger.LogWarning("Session validation failed: user={User} session={Session}", userId, sessionId); context.Fail("Session revoked or expired"); return; }
            var user = await db.Users.AsNoTracking().Include(x => x.UserRoles).ThenInclude(x => x.Role).SingleOrDefaultAsync(x => x.Id == userId, context.HttpContext.RequestAborted);
            if (user is null || user.Deleted) { logger.LogWarning("User validation failed: user={User}", userId); context.Fail("User missing"); return; }
            if (user.Disabled) { context.HttpContext.Items["auth.disabled"] = true; context.Fail("User disabled"); return; }
            var identity = (ClaimsIdentity)context.Principal!.Identity!;
            identity.AddClaims(IdentityService.Permissions(user).Select(x => new Claim("permission", x)));
            identity.AddClaims(user.UserRoles.Where(x => !x.Role.Deleted).Select(x => new Claim(ClaimTypes.Role, x.Role.Name)));
        },
        OnChallenge = async context =>
        {
            context.HandleResponse();
            var disabled = context.HttpContext.Items.ContainsKey("auth.disabled");
            await ApiErrors.Write(context.HttpContext, disabled ? 403 : 401, disabled ? "auth.account_disabled" : context.AuthenticateFailure is SecurityTokenExpiredException ? "auth.token_expired" : "auth.token_invalid", disabled ? "账号已禁用" : "请提供有效的访问令牌");
        },
        OnForbidden = context => ApiErrors.Write(context.HttpContext, 403, "permission.denied", "没有权限执行此操作")
    };
});
builder.Services.AddAuthorization(options => { foreach (var permission in catalog.All) options.AddPolicy(permission.Code, policy => policy.RequireAuthenticatedUser().RequireClaim("permission", permission.Code)); });
builder.Services.AddOpenApi();
var app = builder.Build();
var frontendProxy = app.Services.GetRequiredService<FrontendProxy>();
app.UseMiddleware<ApiErrors>();
app.UseMiddleware<SetupGateMiddleware>();
app.Use(async (http, next) =>
{
    http.Response.Headers.XContentTypeOptions = "nosniff";
    http.Response.Headers.CacheControl = "no-store";
    if (http.Request.Path.StartsWithSegments("/api/v1"))
    {
        var strict = http.Request.Path.StartsWithSegments("/api/v1/auth/login") || http.Request.Path.StartsWithSegments("/api/v1/auth/register") || http.Request.Path.StartsWithSegments("/api/v1/auth/password");
        var store = http.RequestServices.GetRequiredService<IRateLimitStore>();
        var limit = app.Configuration.GetValue<int?>(strict ? "RateLimit:AuthPerMinute" : "RateLimit:GeneralPerMinute") ?? (strict ? 10 : 300);
        if (!await store.Take((strict ? "auth:" : "api:") + http.Connection.RemoteIpAddress, limit, TimeSpan.FromMinutes(1), http.RequestAborted))
        {
            http.Response.Headers.RetryAfter = "60"; throw new ApiException(429, "rate.limited", "请求过于频繁，请稍后重试");
        }
        if (http.Request.Path.StartsWithSegments("/api/v1/auth") && !HttpMethods.IsGet(http.Request.Method))
        {
            var origin = http.Request.Headers.Origin.ToString();
            var allowed = app.Configuration.GetSection("Security:AllowedOrigins").Get<string[]>() ?? [];
            // In Development the app is a local/LAN deployment reached through any origin (vite proxy, LAN IP, public IP);
            // Production must list every allowed origin in Security:AllowedOrigins explicitly.
            var devTrusted = app.Environment.IsDevelopment();
            if (!string.IsNullOrEmpty(origin) && origin != $"{http.Request.Scheme}://{http.Request.Host}" && !allowed.Contains(origin) && !devTrusted) throw ApiException.Forbidden();
        }
    }
    await next(http);
});
app.UseAuthentication(); app.UseAuthorization();
app.UseWebSockets();
app.Use(async (http, next) =>
{
    if ((http.Request.Path.StartsWithSegments("/api/v1/speech") || http.Request.Path.StartsWithSegments("/api/v1/admin/speech")) &&
        !await http.RequestServices.GetRequiredService<PluginStateStore>().IsEnabled("meetings", http.RequestAborted))
        throw ApiException.NotFound();
    await next(http);
});
app.UseMiddleware<PublicCacheMiddleware>();
// Optional single-process hosting: when a built frontend exists under wwwroot/ the backend serves the SPA itself,
// so one process on one port covers both the API and the pages (no reverse proxy needed). Deployments without
// wwwroot keep the API-only behavior. The content root is the working directory the process was started from.
var webRoot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var spaIndex = Path.Combine(webRoot, "index.html");
if (!frontendProxy.Enabled && Directory.Exists(webRoot))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        OnPrepareResponse = ctx =>
        {
            // Vite build assets are content-hashed, so they can be cached aggressively; index.html is served through the fallback below.
            if (!string.Equals(ctx.File.Name, "index.html", StringComparison.OrdinalIgnoreCase))
                ctx.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        }
    });
}
foreach (var module in modules) module.MapEndpoints(app);
SetupEndpoints.Map(app);
app.MapOpenApi().RequireAuthorization("system.read");
async Task Fallback(HttpContext http)
{
    if (http.Request.Path.StartsWithSegments("/api") || http.Request.Path.StartsWithSegments("/health"))
    {
        await Results.Problem(statusCode: 404, title: "资源不存在", extensions: new Dictionary<string, object?> { ["code"] = "resource.not_found" }).ExecuteAsync(http);
        return;
    }
    if (frontendProxy.Enabled)
    {
        await frontendProxy.Forward(http);
        return;
    }
    if (!Path.HasExtension(http.Request.Path.Value) && File.Exists(spaIndex))
    {
        http.Response.Headers.CacheControl = "no-cache";
        await Results.File(spaIndex, "text/html").ExecuteAsync(http);
        return;
    }
    await Results.Problem(statusCode: 404, title: "资源不存在", extensions: new Dictionary<string, object?> { ["code"] = "resource.not_found" }).ExecuteAsync(http);
}
if (frontendProxy.Enabled) app.MapFallback("{**path}", Fallback);
else app.MapFallback(Fallback);
var setup = app.Services.GetRequiredService<SetupService>();
try { await DatabaseBootstrap.Initialize(app.Services, app.Configuration, app.Environment, app.Lifetime.ApplicationStopping); }
catch (Exception ex) when (!app.Environment.IsEnvironment("Testing"))
{
    // A configured but unreachable database must not stop the server: the setup wizard can repair the connection.
    app.Logger.LogError(ex, "Database initialisation failed; starting in setup mode.");
    setup.SetBootstrapError("无法连接或初始化数据库，请检查连接设置");
}
await setup.Prepare(app.Lifetime.ApplicationStopping);
await app.RunAsync();
public partial class Program;
