using System.Net;
using System.Net.Http.Json;
using Classight.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class CommunityPluginTests
{
    private const string Blog = "/api/v1/plugins/blog/api/posts";
    private const string Chat = "/api/v1/plugins/chat/api/messages";

    [Fact]
    public async Task Drafts_are_private_until_published_and_owners_can_withdraw_them()
    {
        await using var app = new ApiFactory();
        using var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        using var author = (await Kit.Member(app, admin, "blog_author")).Client;
        using var reader = (await Kit.Member(app, admin, "blog_reader")).Client;
        var draft = new { title = "学习笔记", summary = "复习 Guide", body = "正文", published = false, version = 1 };
        var created = await Kit.Json(await author.PostAsJsonAsync(Blog, draft));
        var path = $"{Blog}/{created.GetProperty("info").GetProperty("id").GetGuid()}";
        await Kit.Problem(await app.Client().GetAsync(Blog), HttpStatusCode.Unauthorized, "auth.token_invalid");
        await Kit.Problem(await reader.GetAsync(path), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Problem(await admin.GetAsync(path), HttpStatusCode.NotFound, "resource.not_found");
        Assert.Empty((await Kit.Json(await reader.GetAsync(Blog))).GetProperty("items").EnumerateArray());
        Assert.Single((await Kit.Json(await author.GetAsync($"{Blog}?scope=mine"))).GetProperty("items").EnumerateArray());
        await Kit.Json(await author.PutAsJsonAsync(path, draft with { published = true }));
        Assert.Single((await Kit.Json(await reader.GetAsync($"{Blog}?q=guide"))).GetProperty("items").EnumerateArray());
        Assert.Equal("正文", (await Kit.Json(await reader.GetAsync(path))).GetProperty("body").GetString());
        await Kit.Problem(await reader.PutAsJsonAsync(path, draft with { version = 2 }), HttpStatusCode.Forbidden, "permission.denied");
        await Kit.Problem(await author.PutAsJsonAsync(path, draft), HttpStatusCode.Conflict, "resource.version_mismatch");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(path + "?version=2")).StatusCode);
        await Kit.Problem(await author.GetAsync(path), HttpStatusCode.NotFound, "resource.not_found");

        var published = await Kit.Json(await author.PostAsJsonAsync(Blog, draft with { published = true }));
        path = $"{Blog}/{published.GetProperty("info").GetProperty("id").GetGuid()}";
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/blog", new { enabled = false }));
        await Kit.Problem(await author.GetAsync(path), HttpStatusCode.NotFound, "resource.not_found");
        await Kit.Json(await admin.PutAsJsonAsync("/api/v1/admin/plugins/blog", new { enabled = true }));
        await Kit.Json(await author.GetAsync(path));
        await Kit.Json(await author.PutAsJsonAsync(path, draft));
        await Kit.Problem(await reader.GetAsync(path), HttpStatusCode.NotFound, "resource.not_found");
    }

    [Fact]
    public async Task Chat_saves_messages_deduplicates_retries_and_preserves_history_across_dll_reload()
    {
        await using var app = new ApiFactory();
        using var admin = app.As(await Kit.Login(app.Client(), "admin", "IntegrationAdmin123!"));
        using var sender = (await Kit.Member(app, admin, "chat_sender")).Client;
        using var reader = (await Kit.Member(app, admin, "chat_reader")).Client;
        await Kit.Problem(await app.Client().GetAsync(Chat), HttpStatusCode.Unauthorized, "auth.token_invalid");
        var payload = new { clientId = Guid.NewGuid(), body = "班级群聊第一条消息" };
        var first = await Kit.Json(await sender.PostAsJsonAsync(Chat, payload));
        var id = first.GetProperty("id").GetInt64();
        Assert.Equal(id, (await Kit.Json(await sender.PostAsJsonAsync(Chat, payload))).GetProperty("id").GetInt64());
        var second = await Kit.Json(await reader.PostAsJsonAsync(Chat, new { clientId = Guid.NewGuid(), body = "收到" }));
        var latest = await Kit.Json(await reader.GetAsync($"{Chat}?limit=1"));
        var cursor = latest.GetProperty("before").GetInt64();
        Assert.Equal(second.GetProperty("id").GetInt64(), cursor);
        var older = await Kit.Json(await reader.GetAsync($"{Chat}?limit=1&before={cursor}"));
        Assert.Equal(id, Assert.Single(older.GetProperty("items").EnumerateArray()).GetProperty("id").GetInt64());
        await Kit.Problem(await reader.DeleteAsync($"{Chat}/{id}"), HttpStatusCode.Forbidden, "permission.denied");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{Chat}/{id}")).StatusCode);

        var runtime = app.Services.GetRequiredService<PluginRuntime>();
        var file = Path.Combine(runtime.DirectoryPath, "Classight.Chat.dll");
        var backup = file + ".disabled";
        File.Move(file, backup);
        await runtime.ReloadAsync();
        await Kit.Problem(await reader.GetAsync(Chat), HttpStatusCode.NotFound, "resource.not_found");
        File.Move(backup, file);
        await runtime.ReloadAsync();
        var history = await Kit.Json(await reader.GetAsync(Chat));
        var messages = history.GetProperty("items");
        Assert.Equal(2, messages.GetArrayLength());
        Assert.True(messages[0].GetProperty("deleted").GetBoolean());
        Assert.Equal("", messages[0].GetProperty("body").GetString());
        Assert.Equal("收到", messages[1].GetProperty("body").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await reader.DeleteAsync($"{Chat}/{cursor}")).StatusCode);
    }
}
