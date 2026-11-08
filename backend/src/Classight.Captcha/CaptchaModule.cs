using Classight.Contracts;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Captcha;

public sealed class CaptchaModule : IPluginModule
{
    public string Name => "Captcha";
    public PluginManifest Manifest => new("captcha", "Human verification", "Protect sign-in and registration", "1.0.0", Category: "security", Icon: "shield");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => [];
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<CaptchaService>();
        services.AddScoped<ICaptchaVerification>(services => services.GetRequiredService<CaptchaService>());
        services.AddSingleton<IManagedPlugin, CaptchaPlugin>();
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/api/v1/admin/plugins/captcha/config").WithTags("Captcha").RequireAuthorization();
        admin.MapGet("", async ([FromServices] CaptchaService captcha, CancellationToken ct) =>
        {
            var config = await captcha.Read(ct);
            return new { config.Provider, config.SiteKey, config.SceneId, config.Region, config.AccessKeyId, secretConfigured = !string.IsNullOrEmpty(config.Secret), appSecretConfigured = !string.IsNullOrEmpty(config.AppSecret) };
        }).RequireAuthorization("site.settings.read");
        admin.MapPut("", async ([FromBody] CaptchaConfigInput input, [FromServices] CaptchaService captcha, CancellationToken ct) =>
        {
            await captcha.Save(input, ct);
            return Results.NoContent();
        }).RequireAuthorization("site.settings.write");
    }
}
