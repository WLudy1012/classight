using System.Net;
using System.Security.Cryptography;
using System.Text;
using Classight.Api.Updates;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class GitHubUpdateTests
{
    private const string Asset = "ClassightDaemon-win-x64.exe";

    [Theory]
    [InlineData("v1.10.0", false, false, true)]
    [InlineData("v1.2.0", false, false, false)]
    [InlineData("v1.1.0", false, false, false)]
    [InlineData("v1.10.0-rc.1", false, false, false)]
    [InlineData("v1.10.0", true, false, false)]
    [InlineData("v1.10.0", false, true, false)]
    public async Task Only_newer_stable_releases_are_selected(string tag, bool draft, bool prerelease, bool expected)
    {
        using var client = new HttpClient(new Stub(request =>
        {
            Assert.Equal("https://api.github.com/repos/WLudy1012/classight/releases/latest", request.RequestUri!.AbsoluteUri);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""
                    {"tag_name":"{{tag}}","draft":{{draft.ToString().ToLowerInvariant()}},"prerelease":{{prerelease.ToString().ToLowerInvariant()}},"assets":[
                      {"name":"{{Asset}}","state":"uploaded","size":4},
                      {"name":"{{Asset}}.sha256","state":"uploaded","size":65}]}
                    """)
            };
        }));

        var update = await new GitHubReleaseSource(client).FindAsync(new Version(1, 2, 0), Asset, default);
        Assert.Equal(expected, update is not null);
    }

    [Theory]
    [InlineData("release-assets.githubusercontent.com", false)]
    [InlineData("release-assets.githubusercontent.com", true)]
    [InlineData("release-assets.githubusercontent.com.example.org", false)]
    public async Task Asset_download_accepts_only_trusted_redirects_and_verified_content(string redirectHost, bool corrupt)
    {
        var binary = Encoding.UTF8.GetBytes("test");
        var hash = Convert.ToHexStringLower(SHA256.HashData(binary));
        var sidecar = Encoding.UTF8.GetBytes($"{hash}  {Asset}\n");
        var update = new ReleaseUpdate(new Version(1, 3, 0), "v1.3.0", Asset, binary.Length, sidecar.Length, "sha256:" + hash);
        var trusted = redirectHost == "release-assets.githubusercontent.com";
        using var client = new HttpClient(new Stub(request =>
        {
            var uri = request.RequestUri!;
            if (uri.Host == "github.com")
            {
                Assert.StartsWith("/WLudy1012/classight/releases/download/v1.3.0/", uri.AbsolutePath);
                return new HttpResponseMessage(HttpStatusCode.Redirect)
                {
                    Headers = { Location = new Uri($"https://{redirectHost}{uri.AbsolutePath}") }
                };
            }

            Assert.True(trusted);
            Assert.Equal(redirectHost, uri.Host);
            var bytes = uri.AbsolutePath.EndsWith(".sha256", StringComparison.Ordinal) ? sidecar : corrupt ? "fail"u8.ToArray() : binary;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
        }));

        using var output = new MemoryStream();
        var source = new GitHubReleaseSource(client);
        if (trusted && !corrupt)
        {
            Assert.Equal(hash, await source.DownloadAsync(update, output, default));
            Assert.Equal(binary, output.ToArray());
        }
        else await Assert.ThrowsAsync<InvalidDataException>(() => source.DownloadAsync(update, output, default));
    }

    private sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }
}
