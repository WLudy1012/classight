using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Classight.IntegrationTests;

/// <summary>Helpers shared by the speech and setup suites.</summary>
public static class Kit
{
    public static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {text}"); return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
    }
    public static async Task<string> Login(HttpClient client, string account, string password)
    {
        var json = await Json(await client.PostAsJsonAsync("/api/v1/auth/login", new { account, password })); return json.GetProperty("accessToken").GetString()!;
    }
    public static HttpClient As(this ApiFactory app, string token)
    {
        var client = app.Client(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token); return client;
    }
    public static async Task Problem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"expected {(int)status} got {(int)response.StatusCode}: {text}");
        Assert.Equal(code, JsonDocument.Parse(text).RootElement.GetProperty("code").GetString());
    }
    public static async Task<(HttpClient Client, Guid Id)> Member(ApiFactory app, HttpClient admin, string name, string role = "Member")
    {
        var created = await Json(await admin.PostAsJsonAsync("/api/v1/admin/users", new { username = name, displayName = name, password = "MemberPass12345!", roles = new[] { role } }));
        var client = app.As(await Login(app.Client(), name, "MemberPass12345!")); return (client, created.GetProperty("id").GetGuid());
    }
    public static async Task<Guid> OpenSession(HttpClient admin, object? body = null)
    {
        var session = await Json(await admin.PostAsJsonAsync("/api/v1/admin/speech/sessions", body ?? new { title = "第九周班会", date = "2026-11-03", slotMinutes = 5, allowTeams = true, maxTeamSize = 3 }));
        var id = session.GetProperty("id").GetGuid();
        await Json(await admin.PostAsJsonAsync($"/api/v1/admin/speech/sessions/{id}/status", new { status = "open" }));
        return id;
    }
    public static MultipartFormDataContent Upload(byte[] bytes, string fileName)
    {
        var content = new MultipartFormDataContent(); var file = new ByteArrayContent(bytes); file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream"); content.Add(file, "file", fileName); return content;
    }

    /// <summary>A minimal but structurally valid .pptx: a zip with [Content_Types].xml and a ppt/ part.</summary>
    public static byte[] Pptx() => Zip(("[Content_Types].xml", "<Types/>"), ("ppt/presentation.xml", "<p:presentation/>"));
    public static byte[] Pdf() => Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    public static byte[] Ppt() => [.. new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 }, .. new byte[512]];
    public static byte[] Site(params (string Path, string Text)[] files) => Zip(files.Length == 0 ? [("index.html", "<html><body>hi</body></html>"), ("app.js", "console.log(1)")] : files);
    public static byte[] Zip(params (string Path, string Text)[] entries)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            foreach (var (path, text) in entries) { var entry = zip.CreateEntry(path); using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false)); writer.Write(text); }
        return memory.ToArray();
    }
}
