using System.Security.Cryptography;
using System.Text;
using Classight.SharedKernel;
using System.Buffers.Text;

namespace Classight.Speech;

/// <summary>Short-lived HMAC-signed tokens embedded in preview URLs: base64url(payload) "." base64url(signature).</summary>
public sealed class PreviewTokens(IJwtKeyProvider keys, IClock clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private static ApiException Invalid() => new(401, "preview.token_invalid", "预览链接无效或已过期");

    public (string Token, DateTimeOffset ExpiresAt) Create(Guid coursewareId)
    {
        var expires = clock.UtcNow.Add(Lifetime);
        var payload = Encoding.UTF8.GetBytes($"{coursewareId:N}.{expires.ToUnixTimeSeconds()}");
        return (Base64Url.EncodeToString(payload) + "." + Base64Url.EncodeToString(Sign(payload)), expires);
    }
    public Guid Validate(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 256) throw Invalid();
        var parts = token.Split('.');
        if (parts.Length != 2) throw Invalid();
        byte[] payload, signature;
        try { payload = Base64Url.DecodeFromChars(parts[0]); signature = Base64Url.DecodeFromChars(parts[1]); } catch (FormatException) { throw Invalid(); }
        if (!CryptographicOperations.FixedTimeEquals(Sign(payload), signature)) throw Invalid();
        var text = Encoding.UTF8.GetString(payload).Split('.');
        if (text.Length != 2 || !Guid.TryParseExact(text[0], "N", out var id) || !long.TryParse(text[1], out var expiry)) throw Invalid();
        if (DateTimeOffset.FromUnixTimeSeconds(expiry) <= clock.UtcNow) throw Invalid();
        return id;
    }
    private byte[] Sign(byte[] payload) => HMACSHA256.HashData(keys.Derive("preview"), payload);
}
