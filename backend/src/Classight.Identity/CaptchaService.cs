using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Identity;

public sealed class CaptchaPlugin : IManagedPlugin
{
    public string Id => "captcha";
    public bool DefaultEnabled => false;
    public async Task<bool> IsReady(IServiceProvider services, CancellationToken ct) => (await services.GetRequiredService<CaptchaService>().Read(ct)).IsReady();
}

public sealed record CaptchaProof(string? Token, string? Randstr);
public sealed record CaptchaConfigInput(string Provider, string SiteKey, string? SceneId, string? Region, string? AccessKeyId, string? Secret, string? AppSecret);
public sealed class CaptchaConfig
{
    public string Provider { get; set; } = "cloudflare";
    public string SiteKey { get; set; } = "";
    public string SceneId { get; set; } = "";
    public string Region { get; set; } = "cn";
    public string AccessKeyId { get; set; } = "";
    public string Secret { get; set; } = "";
    public string AppSecret { get; set; } = "";
    public bool IsReady() => !string.IsNullOrWhiteSpace(SiteKey) && !string.IsNullOrWhiteSpace(Secret) && (Provider switch
    {
        "cloudflare" => true,
        "aliyun" => !string.IsNullOrWhiteSpace(SceneId) && !string.IsNullOrWhiteSpace(AccessKeyId) && (Region == "cn" || Region == "sgp"),
        "tencent" => uint.TryParse(SiteKey, out _) && !string.IsNullOrWhiteSpace(AccessKeyId) && !string.IsNullOrWhiteSpace(AppSecret),
        _ => false
    });
}
public sealed class CaptchaService(AppDbContext db, PluginStateStore plugins, IDataProtectionProvider protection, IHttpClientFactory clients)
{
    private const string Group = "captcha:config";
    private readonly IDataProtector protector = protection.CreateProtector("Classight.Captcha.Configuration.v1");
    public async Task<CaptchaConfig> Read(CancellationToken ct)
    {
        var json = await db.Settings.AsNoTracking().Where(x => x.Group == Group).Select(x => x.Json).SingleOrDefaultAsync(ct);
        return json is null ? new() : JsonSerializer.Deserialize<CaptchaConfig>(json) ?? new();
    }
    public async Task Save(CaptchaConfigInput input, CancellationToken ct)
    {
        var item = await db.Settings.SingleOrDefaultAsync(x => x.Group == Group, ct);
        var old = item is null ? new CaptchaConfig() : JsonSerializer.Deserialize<CaptchaConfig>(item.Json) ?? new();
        var same = old.Provider == input.Provider;
        var c = new CaptchaConfig { Provider = input.Provider, SiteKey = input.SiteKey?.Trim() ?? "", SceneId = input.SceneId?.Trim() ?? "", Region = input.Region?.Trim() ?? "cn", AccessKeyId = input.AccessKeyId?.Trim() ?? "", Secret = string.IsNullOrWhiteSpace(input.Secret) ? (same ? old.Secret : "") : protector.Protect(input.Secret), AppSecret = string.IsNullOrWhiteSpace(input.AppSecret) ? (same ? old.AppSecret : "") : protector.Protect(input.AppSecret) };
        if (!c.IsReady() || new[] { c.SiteKey, c.SceneId, c.Region, c.AccessKeyId, input.Secret ?? "", input.AppSecret ?? "" }.Any(x => x.Length > 2048)) throw ApiException.Validation("config", "请完整填写有效的验证服务配置");
        if (item is null) { item = new Setting { Group = Group }; db.Settings.Add(item); }
        item.Json = JsonSerializer.Serialize(c);
        await db.SaveChangesAsync(ct);
    }
    public async Task<object> Public(CancellationToken ct)
    {
        if (!await plugins.IsEnabled("captcha", ct)) return new { enabled = false };
        var c = await Read(ct);
        return new { enabled = true, provider = c.Provider, siteKey = c.SiteKey, sceneId = c.SceneId, region = c.Region };
    }
    public async Task Verify(CaptchaProof? proof, HttpContext http, CancellationToken ct)
    {
        if (!await plugins.IsEnabled("captcha", ct)) return;
        var c = await Read(ct);
        if (!c.IsReady() || proof?.Token is null || proof.Token.Length is < 1 or > 16384 || (proof.Randstr?.Length ?? 0) > 1024) throw new ApiException(422, "captcha.invalid", "请完成人机验证后重试");
        try
        {
            var secret = protector.Unprotect(c.Secret);
            var client = clients.CreateClient("captcha");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            using var response = c.Provider switch
            {
                "cloudflare" => await Cloudflare(client, secret, proof, http, timeout.Token),
                "aliyun" => await Aliyun(client, c, secret, proof, timeout.Token),
                "tencent" => await Tencent(client, c, secret, protector.Unprotect(c.AppSecret), proof, http, timeout.Token),
                _ => throw new InvalidOperationException()
            };
            if (!response.IsSuccessStatusCode) throw new HttpRequestException();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var root = doc.RootElement;
            var ok = c.Provider switch
            {
                "cloudflare" => root.TryGetProperty("success", out var cf) && cf.ValueKind == JsonValueKind.True,
                "aliyun" => root.TryGetProperty("Success", out var al) && al.ValueKind == JsonValueKind.True && root.TryGetProperty("Result", out var result) && result.TryGetProperty("VerifyResult", out var ar) && ar.ValueKind == JsonValueKind.True,
                "tencent" => root.TryGetProperty("Response", out var tr) && tr.TryGetProperty("CaptchaCode", out var code) && code.TryGetInt32(out var n) && n == 1,
                _ => false
            };
            if (!ok) throw new ApiException(422, "captcha.invalid", "验证未通过，请重新验证");
        }
        catch (ApiException) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or CryptographicException or InvalidOperationException)
        { throw new ApiException(503, "captcha.unavailable", "人机验证暂时不可用，请稍后重试"); }
    }
    private static Task<HttpResponseMessage> Cloudflare(HttpClient client, string secret, CaptchaProof proof, HttpContext http, CancellationToken ct) => client.PostAsync("https://challenges.cloudflare.com/turnstile/v0/siteverify", new FormUrlEncodedContent(new Dictionary<string, string> { ["secret"] = secret, ["response"] = proof.Token!, ["remoteip"] = http.Connection.RemoteIpAddress?.ToString() ?? "" }), ct);
    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static byte[] Hmac(byte[] key, string value) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(value));
    private static async Task<HttpResponseMessage> Aliyun(HttpClient client, CaptchaConfig c, string secret, CaptchaProof proof, CancellationToken ct)
    {
        var host = c.Region == "sgp" ? "captcha.ap-southeast-1.aliyuncs.com" : "captcha.cn-shanghai.aliyuncs.com";
        using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["CaptchaVerifyParam"] = proof.Token!, ["SceneId"] = c.SceneId });
        var body = await content.ReadAsStringAsync(ct); var hash = Hash(body);
        var date = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"); var nonce = Guid.NewGuid().ToString("N");
        const string names = "content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version";
        var headers = $"content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:{host}\nx-acs-action:VerifyIntelligentCaptcha\nx-acs-content-sha256:{hash}\nx-acs-date:{date}\nx-acs-signature-nonce:{nonce}\nx-acs-version:2023-03-05\n";
        var canonical = $"POST\n/\n\n{headers}\n{names}\n{hash}";
        var signature = Convert.ToHexStringLower(Hmac(Encoding.UTF8.GetBytes(secret), $"ACS3-HMAC-SHA256\n{Hash(canonical)}"));
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://{host}/"); request.Content = new StringContent(body, Encoding.UTF8, "application/x-www-form-urlencoded");
        request.Headers.TryAddWithoutValidation("x-acs-action", "VerifyIntelligentCaptcha"); request.Headers.TryAddWithoutValidation("x-acs-content-sha256", hash); request.Headers.TryAddWithoutValidation("x-acs-date", date); request.Headers.TryAddWithoutValidation("x-acs-signature-nonce", nonce); request.Headers.TryAddWithoutValidation("x-acs-version", "2023-03-05"); request.Headers.TryAddWithoutValidation("Authorization", $"ACS3-HMAC-SHA256 Credential={c.AccessKeyId},SignedHeaders={names},Signature={signature}");
        return await client.SendAsync(request, ct);
    }
    private static async Task<HttpResponseMessage> Tencent(HttpClient client, CaptchaConfig c, string secret, string appSecret, CaptchaProof proof, HttpContext http, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(proof.Randstr)) throw new ApiException(422, "captcha.invalid", "请重新完成人机验证");
        const string host = "captcha.tencentcloudapi.com"; const string contentType = "application/json; charset=utf-8";
        var body = JsonSerializer.Serialize(new { CaptchaAppId = uint.Parse(c.SiteKey), CaptchaType = 9, Ticket = proof.Token, Randstr = proof.Randstr, UserIp = http.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1", AppSecretKey = appSecret });
        var now = DateTimeOffset.UtcNow; var timestamp = now.ToUnixTimeSeconds(); var date = now.ToString("yyyy-MM-dd"); var scope = $"{date}/captcha/tc3_request";
        var canonical = $"POST\n/\n\ncontent-type:{contentType}\nhost:{host}\n\ncontent-type;host\n{Hash(body)}";
        var toSign = $"TC3-HMAC-SHA256\n{timestamp}\n{scope}\n{Hash(canonical)}";
        var key = Hmac(Hmac(Hmac(Encoding.UTF8.GetBytes("TC3" + secret), date), "captcha"), "tc3_request"); var signature = Convert.ToHexStringLower(Hmac(key, toSign));
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://{host}/"); request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        request.Headers.TryAddWithoutValidation("Authorization", $"TC3-HMAC-SHA256 Credential={c.AccessKeyId}/{scope}, SignedHeaders=content-type;host, Signature={signature}"); request.Headers.TryAddWithoutValidation("X-TC-Action", "DescribeCaptchaResult"); request.Headers.TryAddWithoutValidation("X-TC-Version", "2019-07-22"); request.Headers.TryAddWithoutValidation("X-TC-Timestamp", timestamp.ToString());
        return await client.SendAsync(request, ct);
    }
}
