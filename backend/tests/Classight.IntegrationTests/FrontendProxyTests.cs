using System.Net;
using System.Net.WebSockets;
using System.Text;
using Classight.Api;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class FrontendProxyTests
{
    [Theory]
    [InlineData("file:///tmp/index.html")]
    [InlineData("https://user:password@example.com/")]
    [InlineData("https://example.com/path")]
    [InlineData("https://example.com/?target=other")]
    public void Rejects_non_origin_destinations(string address)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["FrontendProxy:Address"] = address }).Build();
        Assert.Throws<InvalidOperationException>(() => new FrontendProxy(config, null!));
    }

    [Fact]
    public async Task Without_a_proxy_static_assets_and_spa_fallback_remain_available()
    {
        var root = Path.Combine(Path.GetTempPath(), "classight-web-" + Guid.NewGuid().ToString("N"));
        try
        {
            var web = Path.Combine(root, "wwwroot");
            Directory.CreateDirectory(web);
            await File.WriteAllTextAsync(Path.Combine(web, "index.html"), "<html>classight</html>");
            await File.WriteAllTextAsync(Path.Combine(web, "main.js"), "console.log(1)");
            await using var basis = new ApiFactory();
            await using var app = basis.WithWebHostBuilder(host => host.UseContentRoot(root).UseWebRoot(web));
            using var client = app.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
            Assert.Equal("<html>classight</html>", await client.GetStringAsync("/center"));
            Assert.Equal("console.log(1)", await client.GetStringAsync("/main.js"));
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/missing.js")).StatusCode);
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Configured_frontend_proxies_assets_and_routes_but_not_api_or_credentials()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var upstream = builder.Build();
        upstream.UseWebSockets();
        upstream.Run(async context =>
        {
            if (context.WebSockets.IsWebSocketRequest)
            {
                using var socket = await context.WebSockets.AcceptWebSocketAsync();
                var buffer = new byte[256];
                var incoming = await socket.ReceiveAsync(buffer.AsMemory(), context.RequestAborted);
                await socket.SendAsync(buffer.AsMemory(0, incoming.Count), incoming.MessageType, incoming.EndOfMessage, context.RequestAborted);
                return;
            }
            context.Response.Headers.Append("Set-Cookie", "upstream=bad");
            await context.Response.WriteAsync($"{context.Request.Path}{context.Request.QueryString}|{context.Request.Headers.Authorization}|{context.Request.Headers.Cookie}");
        });
        await upstream.StartAsync();
        var address = upstream.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();

        await using var basis = new ApiFactory();
        await using var proxy = basis.WithWebHostBuilder(host => host.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["FrontendProxy:Address"] = address })));
        proxy.UseKestrel(options => options.Listen(IPAddress.Loopback, 0));
        using var client = proxy.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
        var proxyAddress = proxy.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        client.BaseAddress = new Uri(proxyAddress);
        var request = new HttpRequestMessage(HttpMethod.Get, "/assets/app.js?v=7");
        request.Headers.Add("Authorization", "Bearer sensitive");
        request.Headers.Add("Cookie", "session=sensitive");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("/assets/app.js?v=7||", await response.Content.ReadAsStringAsync());
        Assert.False(response.Headers.Contains("Set-Cookie"));
        Assert.Equal("/center||", await client.GetStringAsync("/center"));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/not-a-route.js")).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsync("/frontend", null)).StatusCode);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(new Uri(proxyAddress.Replace("http://", "ws://") + "/hmr"), timeout.Token);
        await socket.SendAsync(Encoding.UTF8.GetBytes("ping"), WebSocketMessageType.Text, true, timeout.Token);
        var reply = new byte[32];
        var received = await socket.ReceiveAsync(reply.AsMemory(), timeout.Token);
        Assert.Equal("ping", Encoding.UTF8.GetString(reply, 0, received.Count));
    }
}
