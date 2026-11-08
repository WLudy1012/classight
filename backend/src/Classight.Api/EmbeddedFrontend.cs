using System.IO.Compression;
using Microsoft.AspNetCore.StaticFiles;

namespace Classight.Api;

public sealed class EmbeddedFrontend
{
    private readonly Dictionary<string, byte[]> files = new(StringComparer.Ordinal);
    private readonly FileExtensionContentTypeProvider types = new();

    public EmbeddedFrontend()
    {
        using var stream = typeof(EmbeddedFrontend).Assembly.GetManifestResourceStream("Classight.Frontend.zip");
        if (stream is null) return;
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)))
        {
            using var source = entry.Open();
            using var target = new MemoryStream();
            source.CopyTo(target);
            files.Add("/" + entry.FullName, target.ToArray());
        }
    }

    public bool Available => files.ContainsKey("/index.html");

    public async Task<bool> Serve(HttpContext http, string path)
    {
        if ((!HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method)) || !files.TryGetValue(path, out var content)) return false;
        http.Response.ContentType = types.TryGetContentType(path, out var type) ? type : "application/octet-stream";
        http.Response.ContentLength = content.Length;
        http.Response.Headers.CacheControl = path.StartsWith("/assets/", StringComparison.Ordinal) ? "public, max-age=31536000, immutable" : "no-cache";
        if (!HttpMethods.IsHead(http.Request.Method)) await http.Response.Body.WriteAsync(content, http.RequestAborted);
        return true;
    }
}
