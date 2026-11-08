using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Classight.Api.Updates;

internal static class ReleaseVersion
{
    internal static string Current { get; } = WithoutBuildMetadata(typeof(Program).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion) ?? "0.0.0";

    internal static string? WithoutBuildMetadata(string? value) => value?.Split('+', 2)[0];

    internal static Version? ParseStable(string? value) => Version.TryParse(value, out var parsed)
        && parsed.Build >= 0 && parsed.Revision == -1 && value == parsed.ToString(3) ? parsed : null;
}

internal sealed record ReleaseUpdate(Version Version, string Tag, string AssetName, long Size, long ChecksumSize, string? Digest);

internal sealed class GitHubReleaseSource(HttpClient client)
{
    internal const string ClientName = "Classight.ReleaseUpdates";
    private const string Repository = "WLudy1012/classight";
    private const int MaxMetadataSize = 256 * 1024;
    private const int MaxChecksumSize = 4096;
    private const long MaxBinarySize = 512 * 1024 * 1024;
    private static readonly Uri LatestRelease = new($"https://api.github.com/repos/{Repository}/releases/latest");
    private static readonly JsonSerializerOptions ReleaseJson = new(JsonSerializerDefaults.Web);

    internal async Task<ReleaseUpdate?> FindAsync(Version currentVersion, string assetName, CancellationToken ct)
    {
        using var response = await client.GetAsync(LatestRelease, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        var bytes = await ReadSmallBodyAsync(response, MaxMetadataSize, ct);
        var release = JsonSerializer.Deserialize<ReleaseResponse>(bytes, ReleaseJson);
        if (release is not { Draft: false, Prerelease: false, Tag: ['v', ..], Assets: not null }) return null;
        var version = ReleaseVersion.ParseStable(release.Tag[1..]);
        if (version is null || version <= currentVersion) return null;

        var binary = release.Assets.SingleOrDefault(item => item.Name == assetName && item.State == "uploaded");
        var checksum = release.Assets.SingleOrDefault(item => item.Name == assetName + ".sha256" && item.State == "uploaded");
        if (binary is not { Size: > 0 and <= MaxBinarySize } || checksum is not { Size: > 0 and <= MaxChecksumSize })
            throw new InvalidDataException($"Release {release.Tag} is missing a valid binary or checksum for {assetName}.");

        return new ReleaseUpdate(version, release.Tag, assetName, binary.Size, checksum.Size, binary.Digest);
    }

    internal async Task<string> DownloadAsync(ReleaseUpdate release, Stream destination, CancellationToken ct)
    {
        using var checksumResponse = await GetAssetAsync(release.Tag, release.AssetName + ".sha256", ct);
        var checksumBytes = await ReadSmallBodyAsync(checksumResponse, MaxChecksumSize, ct);
        if (checksumBytes.Length != release.ChecksumSize)
            throw new InvalidDataException("Release checksum size does not match GitHub metadata.");

        var checksumText = Encoding.UTF8.GetString(checksumBytes).Trim();
        var parts = checksumText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length is < 1 or > 2 || !IsSha256(parts[0]) ||
            (parts.Length == 2 && parts[1].TrimStart('*') != release.AssetName))
            throw new InvalidDataException("Release checksum file is invalid.");

        var checksum = parts[0].ToLowerInvariant();
        if (release.Digest is not null && !string.Equals(release.Digest, "sha256:" + checksum, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Release checksum does not match GitHub's recorded asset digest.");

        using var response = await GetAssetAsync(release.Tag, release.AssetName, ct);
        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        if (response.Content.Headers.ContentLength is long length && length != release.Size)
            throw new InvalidDataException("Release binary size does not match GitHub metadata.");

        await using var source = await response.Content.ReadAsStreamAsync(ct);
        var buffer = new byte[64 * 1024];
        long total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > release.Size) throw new InvalidDataException("Release binary exceeds its declared size.");
            digest.AppendData(buffer, 0, read);
            await destination.WriteAsync(buffer.AsMemory(0, read), ct);
        }

        if (total != release.Size || Convert.ToHexStringLower(digest.GetHashAndReset()) != checksum)
            throw new InvalidDataException("Release binary failed SHA-256 verification.");

        return checksum;
    }

    internal static bool IsSha256(string? value) => value is { Length: 64 } && value.All(Uri.IsHexDigit);

    private async Task<HttpResponseMessage> GetAssetAsync(string tag, string name, CancellationToken ct)
    {
        var address = new Uri($"https://github.com/{Repository}/releases/download/{tag}/{name}");
        for (var redirects = 0; redirects <= 3; redirects++)
        {
            var response = await client.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, ct);
            if (response.IsSuccessStatusCode) return response;

            using (response)
            {
                if (response.StatusCode is not (HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or
                    HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect))
                    response.EnsureSuccessStatusCode();

                if (response.Headers.Location is not { IsAbsoluteUri: true } next ||
                    next.Scheme != Uri.UriSchemeHttps || !next.IsDefaultPort || next.UserInfo.Length != 0 ||
                    next.IdnHost is not ("release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
                    throw new InvalidDataException("GitHub asset download redirected outside the trusted release asset hosts.");
                address = next;
            }
        }

        throw new InvalidDataException("GitHub asset download exceeded the redirect limit.");
    }

    private static async Task<byte[]> ReadSmallBodyAsync(HttpResponseMessage response, int limit, CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("GitHub response exceeds its size limit.");
        await using var source = await response.Content.ReadAsStreamAsync(ct);
        using var destination = new MemoryStream();
        var buffer = new byte[4096];
        int read;
        while ((read = await source.ReadAsync(buffer, ct)) > 0)
        {
            if (destination.Length + read > limit) throw new InvalidDataException("GitHub response exceeds its size limit.");
            destination.Write(buffer, 0, read);
        }
        return destination.ToArray();
    }

    private sealed record ReleaseResponse([property: JsonPropertyName("tag_name")] string? Tag,
        bool Draft, bool Prerelease, ReleaseAsset[]? Assets);
    private sealed record ReleaseAsset(string Name, string State, long Size, string? Digest);
}
