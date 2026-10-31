using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Classight.Platform;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class CaptchaTests
{
    private sealed class ProviderState { public string Result = "success"; public List<string> Calls = []; public HashSet<string> Redeemed = []; }
    private sealed class Handler(ProviderState state) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = await request.Content!.ReadAsStringAsync(ct);
            state.Calls.Add(request.RequestUri!.Host + " " + request.Headers.ToString() + " " + body);
            if (state.Result == "network") throw new HttpRequestException();
            var valid = state.Result == "success" && state.Redeemed.Add(request.RequestUri.Host + body);
            var json = request.RequestUri.Host switch {
                "challenges.cloudflare.com" => valid ? "{\"success\":true}" : "{\"success\":false}",
                "captcha.tencentcloudapi.com" => valid ? "{\"Response\":{\"CaptchaCode\":1}}" : "{\"Response\":{\"CaptchaCode\":9}}",
                _ => valid ? "{\"Success\":true,\"Result\":{\"VerifyResult\":true}}" : "{\"Success\":true,\"Result\":{\"VerifyResult\":false}}"
            };
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }
    [Fact]
    public async Task Verification_is_enforced_for_all_providers_and_secrets_are_hidden()
    {
        var provider = new ProviderState();
        await using var app = new ApiFactory();
        await using var configured = app.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddHttpClient("captcha").ConfigurePrimaryHttpMessageHandler(() => new Handler(provider))));
        using var client = configured.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        var login = await Kit.Json(await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("accessToken").GetString());
        async Task Configure(string name) {
            var response = await client.PutAsJsonAsync("/api/v1/admin/plugins/captcha/config", new { provider = name, siteKey = name == "tencent" ? "123456" : "site-public", sceneId = "scene", region = "cn", accessKeyId = "key-id", secret = "secret-value", appSecret = "app-secret-value" });
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            var config = await client.GetStringAsync("/api/v1/admin/plugins/captcha/config");
            Assert.DoesNotContain("secret-value", config); Assert.DoesNotContain("app-secret-value", config);
        }
        await Configure("cloudflare");
        using (var scope = configured.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<PluginStateStore>().SetEnabled("captcha", true, default);
        await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" }), HttpStatusCode.UnprocessableEntity, "captcha.invalid");
        await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/register", new { inviteCode = "unused", username = "test", displayName = "Test", password = "TestPassword123!" }), HttpStatusCode.UnprocessableEntity, "captcha.invalid");
        foreach (var name in new[] { "cloudflare", "aliyun", "tencent" }) {
            if (name != "cloudflare") await Configure(name);
            var publicConfig = await Kit.Json(await client.GetAsync("/api/v1/auth/captcha")); Assert.True(publicConfig.GetProperty("enabled").GetBoolean()); Assert.Equal(name, publicConfig.GetProperty("provider").GetString());
            object body = new { account = "admin", password = "IntegrationAdmin123!", captcha = new { token = "proof", randstr = "random" } };
            provider.Result = "invalid"; await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", body), HttpStatusCode.UnprocessableEntity, "captcha.invalid");
            provider.Result = "network"; await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", body), HttpStatusCode.ServiceUnavailable, "captcha.unavailable");
            provider.Result = "success"; Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", body)).StatusCode);
            await Kit.Problem(await client.PostAsJsonAsync("/api/v1/auth/login", body), HttpStatusCode.UnprocessableEntity, "captcha.invalid");
        }
        Assert.Contains(provider.Calls, x => x.Contains("ACS3-HMAC-SHA256 Credential=key-id"));
        Assert.Contains(provider.Calls, x => x.Contains("TC3-HMAC-SHA256 Credential=key-id"));
        using (var scope = configured.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<PluginStateStore>().SetEnabled("captcha", false, default);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { account = "admin", password = "IntegrationAdmin123!" })).StatusCode);
    }
}
