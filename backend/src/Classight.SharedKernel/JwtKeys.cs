using System.Security.Cryptography;
using System.Text;

namespace Classight.SharedKernel;

/// <summary>Holds the JWT signing key at runtime so the setup wizard can replace the development default without a restart.</summary>
public interface IJwtKeyProvider
{
    byte[] KeyBytes { get; }
    bool IsDefault { get; }
    void Replace(string key);
    /// <summary>Derives an independent HMAC key for a purpose (for example signed preview URLs) from the JWT key.</summary>
    byte[] Derive(string purpose);
}

public sealed class JwtKeyProvider : IJwtKeyProvider
{
    public const string DevelopmentDefault = "development-only-classight-key-change-me-01234567890123456789";
    private volatile byte[] key;
    public JwtKeyProvider(string initial) => key = Encoding.UTF8.GetBytes(initial);
    public byte[] KeyBytes => key;
    public bool IsDefault => key.AsSpan().SequenceEqual(Encoding.UTF8.GetBytes(DevelopmentDefault));
    public void Replace(string value)
    {
        if (Encoding.UTF8.GetByteCount(value) < 32) throw new ArgumentException("JWT key must be at least 32 bytes.", nameof(value));
        key = Encoding.UTF8.GetBytes(value);
    }
    public byte[] Derive(string purpose) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes("classight:" + purpose));
}
