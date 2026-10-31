using System.IO.Compression;
using System.Text.RegularExpressions;
using Classight.SharedKernel;
using Microsoft.Extensions.Configuration;

namespace Classight.Speech;

public sealed record DetectedFile(string Kind, string? WebEntry);

/// <summary>
/// Courseware files live under Storage:LocalPath/courseware/{id}/ : original, converted.pdf and an extracted site/ tree.
/// All path handling for untrusted names goes through this class.
/// </summary>
public sealed class CoursewareStore
{
    public const long MaxUncompressedBytes = 100L * 1024 * 1024;
    public const int MaxEntries = 2000;
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".html", ".htm", ".css", ".js", ".mjs", ".json", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".webm", ".ogg", ".wav", ".txt", ".md", ".xml"
    };
    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".htm"] = "text/html; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8", [".mjs"] = "text/javascript; charset=utf-8", [".json"] = "application/json; charset=utf-8", [".map"] = "application/json; charset=utf-8",
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp", [".svg"] = "image/svg+xml", [".ico"] = "image/x-icon",
        [".woff"] = "font/woff", [".woff2"] = "font/woff2", [".ttf"] = "font/ttf", [".otf"] = "font/otf",
        [".mp3"] = "audio/mpeg", [".mp4"] = "video/mp4", [".webm"] = "video/webm", [".ogg"] = "audio/ogg", [".wav"] = "audio/wav",
        [".txt"] = "text/plain; charset=utf-8", [".md"] = "text/markdown; charset=utf-8", [".xml"] = "application/xml; charset=utf-8"
    };
    private static readonly Regex ReservedName = new(@"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly StringComparison PathComparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
    private readonly string root;

    public CoursewareStore(IConfiguration config) => root = Path.GetFullPath(Path.Combine(config["Storage:LocalPath"] ?? "data/media", "courseware"));
    public string Root => root;
    public string Dir(Guid id) => Path.Combine(root, id.ToString("N"));
    public string OriginalPath(Guid id) => Path.Combine(Dir(id), "original");
    public string PdfPath(Guid id) => Path.Combine(Dir(id), "converted.pdf");
    public string SiteRoot(Guid id) => Path.Combine(Dir(id), "site");
    public static string ContentTypeFor(string extension) => ContentTypes.GetValueOrDefault(extension) ?? "application/octet-stream";

    public static ApiException Unsupported() => new(422, "courseware.unsupported_type", "仅支持 pptx、ppt、pdf，或根目录含 index.html 的网页项目 zip");
    public static ApiException Invalid(string reason) => new(422, "courseware.invalid_archive", reason);

    public async Task<DetectedFile> Save(Guid id, Stream input, string fileName, CancellationToken ct)
    {
        var dir = Dir(id); Directory.CreateDirectory(dir);
        try
        {
            await using (var output = new FileStream(OriginalPath(id), FileMode.CreateNew, FileAccess.Write)) await input.CopyToAsync(output, ct);
            var detected = Detect(OriginalPath(id), fileName);
            if (detected.Kind == "web") return detected with { WebEntry = ExtractSite(OriginalPath(id), SiteRoot(id)) };
            return detected;
        }
        catch { Delete(id); throw; }
    }

    public void Delete(Guid id)
    {
        var dir = Dir(id);
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>Type detection by magic bytes plus extension.</summary>
    public static DetectedFile Detect(string path, string fileName)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        using var file = File.OpenRead(path);
        var head = new byte[1024]; var read = file.ReadAtLeast(head, head.Length, false);
        if (read == 0) throw ApiException.Validation("file", "文件为空");
        var span = head.AsSpan(0, read);
        switch (extension)
        {
            case ".pdf":
                if (span.IndexOf("%PDF-"u8) < 0) throw Unsupported();
                return new("pdf", null);
            case ".ppt":
                if (!span.StartsWith(new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 })) throw Unsupported();
                return new("ppt", null);
            case ".pptx":
            case ".zip":
                if (!span.StartsWith(new byte[] { 0x50, 0x4B, 0x03, 0x04 })) throw Unsupported();
                file.Position = 0;
                try
                {
                    using var zip = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: true);
                    var names = zip.Entries.Select(x => x.FullName.Replace('\\', '/')).ToList();
                    var office = names.Contains("[Content_Types].xml") && names.Any(x => x.StartsWith("ppt/", StringComparison.Ordinal));
                    if (extension == ".pptx") return office ? new("pptx", null) : throw Unsupported();
                    if (office) throw Unsupported();
                    return new("web", null);
                }
                catch (InvalidDataException) { throw Invalid("压缩包已损坏或格式不受支持"); }
            default: throw Unsupported();
        }
    }

    private static string NormalizeEntry(string raw)
    {
        var name = raw.Replace('\\', '/');
        if (name.StartsWith('/') || name.Length >= 2 && name[1] == ':') throw Invalid("压缩包包含绝对路径");
        var parts = new List<string>();
        foreach (var part in name.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == "..") throw Invalid("压缩包包含越界路径");
            if (part == ".") continue;
            if (part.Contains('\0') || part.Contains(':')) throw Invalid("压缩包包含非法路径");
            parts.Add(part);
        }
        return string.Join('/', parts);
    }

    /// <summary>Extracts a web-project zip into siteRoot (flattening a single top-level folder) and returns the entry html name.</summary>
    public static string ExtractSite(string zipPath, string siteRoot)
    {
        try
        {
            using var archive = ZipFile.OpenRead(zipPath);
            if (archive.Entries.Count > MaxEntries) throw Invalid($"压缩包条目数超过 {MaxEntries}");
            var files = new List<(ZipArchiveEntry Entry, string Path)>(); long declared = 0;
            foreach (var entry in archive.Entries)
            {
                var raw = entry.FullName;
                if (raw.EndsWith('/') || raw.EndsWith('\\')) { NormalizeEntry(raw); continue; }
                var path = NormalizeEntry(raw);
                if (path.Length == 0) continue;
                if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw Invalid("压缩包包含符号链接");
                if (path.StartsWith("__MACOSX/", StringComparison.Ordinal)) continue;
                declared += entry.Length;
                if (declared > MaxUncompressedBytes) throw Invalid("解压后总大小超过 100MB");
                files.Add((entry, path));
            }
            var prefix = "";
            if (!files.Any(x => string.Equals(x.Path, "index.html", StringComparison.OrdinalIgnoreCase)))
            {
                var tops = files.Where(x => x.Path is not (".DS_Store" or "Thumbs.db")).Select(x => x.Path.Contains('/') ? x.Path[..x.Path.IndexOf('/')] : "").Distinct().ToList();
                if (tops.Count != 1 || tops[0].Length == 0 || !files.Any(x => string.Equals(x.Path, tops[0] + "/index.html", StringComparison.OrdinalIgnoreCase))) throw Invalid("压缩包根目录缺少 index.html");
                prefix = tops[0] + "/";
            }
            var siteFull = Path.GetFullPath(siteRoot); Directory.CreateDirectory(siteFull);
            string? entryName = null; long total = 0;
            foreach (var (entry, path) in files)
            {
                if (!path.StartsWith(prefix, StringComparison.Ordinal)) continue;
                var relative = path[prefix.Length..];
                var segments = relative.Split('/');
                if (!AllowedExtensions.Contains(Path.GetExtension(relative))) continue;
                if (segments.Any(x => x.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || x.EndsWith('.') || x.EndsWith(' ') || ReservedName.IsMatch(x))) continue;
                var target = Path.GetFullPath(Path.Combine(siteFull, relative));
                if (!target.StartsWith(siteFull + Path.DirectorySeparatorChar, PathComparison)) throw Invalid("压缩包包含越界路径");
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                long written = 0; var buffer = new byte[81920];
                using (var source = entry.Open())
                using (var output = new FileStream(target, FileMode.Create, FileAccess.Write))
                {
                    int count;
                    while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        written += count; total += count;
                        if (written > entry.Length || total > MaxUncompressedBytes) throw Invalid("解压后大小超过声明或总量超过 100MB");
                        output.Write(buffer, 0, count);
                    }
                }
                if (string.Equals(relative, "index.html", StringComparison.OrdinalIgnoreCase)) entryName = relative;
            }
            return entryName ?? throw Invalid("压缩包根目录缺少 index.html");
        }
        catch (InvalidDataException) { throw Invalid("压缩包已损坏"); }
        catch (Exception ex) when (ex is IOException or ArgumentException or NotSupportedException or UnauthorizedAccessException) { throw Invalid("压缩包无法解压"); }
    }

    /// <summary>Resolves a request path inside the extracted site. Returns null for anything outside the site root or missing.</summary>
    public string? ResolveSiteFile(Guid id, string? relative, string entry)
    {
        if (string.IsNullOrWhiteSpace(relative)) relative = entry;
        var parts = new List<string>();
        foreach (var part in relative.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part is "." or ".." || part.Contains('\0') || part.Contains(':') || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
            parts.Add(part);
        }
        var siteFull = Path.GetFullPath(SiteRoot(id));
        string full;
        try { full = Path.GetFullPath(Path.Combine(siteFull, string.Join(Path.DirectorySeparatorChar, parts))); } catch (ArgumentException) { return null; }
        if (!full.StartsWith(siteFull + Path.DirectorySeparatorChar, PathComparison)) return null;
        if (Directory.Exists(full)) full = Path.Combine(full, "index.html");
        return File.Exists(full) ? full : null;
    }
}
