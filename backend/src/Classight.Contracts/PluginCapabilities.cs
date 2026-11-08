using Microsoft.AspNetCore.Http;

namespace Classight.Contracts;

public sealed record CaptchaProof(string? Token, string? Randstr);
public sealed record CaptchaPublicConfiguration(bool Enabled, string? Provider = null, string? SiteKey = null, string? SceneId = null, string? Region = null);
public interface ICaptchaVerification
{
    Task<CaptchaPublicConfiguration> Public(CancellationToken ct);
    Task Verify(CaptchaProof? proof, HttpContext http, CancellationToken ct);
}

public interface IPresentationConverter
{
    bool Available { get; }
    string? Command { get; }
    Task<string?> ConvertToPdf(string inputPath, string workDirectory, CancellationToken ct);
}
