using System.Net;
using Yarp.ReverseProxy.Forwarder;

namespace Classight.Api;

public sealed class FrontendProxy : IDisposable
{
    private const string LoopHeader = "X-Classight-Proxy-Hop";
    private readonly string marker = Guid.NewGuid().ToString("N");
    private readonly HttpMessageInvoker client = new(new SocketsHttpHandler
    {
        UseProxy = false,
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        UseCookies = false,
        EnableMultipleHttp2Connections = true,
        ConnectTimeout = TimeSpan.FromSeconds(15)
    });
    private readonly ForwarderRequestConfig requestConfig = new() { ActivityTimeout = TimeSpan.FromSeconds(100) };
    private readonly IHttpForwarder forwarder;
    private readonly HttpTransformer transformer;
    private readonly string? address;

    public FrontendProxy(IConfiguration configuration, IHttpForwarder forwarder)
    {
        this.forwarder = forwarder;
        var configured = configuration["FrontendProxy:Address"]?.Trim();
        if (!string.IsNullOrEmpty(configured))
        {
            if (!Uri.TryCreate(configured, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment) || uri.AbsolutePath != "/")
                throw new InvalidOperationException("FrontendProxy:Address must be an HTTP(S) origin without credentials, path, query or fragment.");
            address = uri.GetLeftPart(UriPartial.Authority) + "/";
        }
        transformer = new FrontendTransformer(marker);
    }

    public bool Enabled => address is not null;

    public async Task Forward(HttpContext context)
    {
        if (context.Request.Headers[LoopHeader] == marker)
        {
            context.Response.StatusCode = StatusCodes.Status508LoopDetected;
            return;
        }
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
            context.Response.Headers.Allow = "GET, HEAD";
            return;
        }
        await forwarder.SendAsync(context, address!, client, requestConfig, transformer);
    }

    public void Dispose() => client.Dispose();

    private sealed class FrontendTransformer(string marker) : HttpTransformer
    {
        public override async ValueTask TransformRequestAsync(HttpContext context, HttpRequestMessage request, string destinationPrefix, CancellationToken cancellationToken)
        {
            await base.TransformRequestAsync(context, request, destinationPrefix, cancellationToken);
            request.Headers.Host = null;
            request.Headers.Remove("Authorization");
            request.Headers.Remove("Cookie");
            request.Headers.Remove(LoopHeader);
            request.Headers.TryAddWithoutValidation(LoopHeader, marker);
        }

        public override async ValueTask<bool> TransformResponseAsync(HttpContext context, HttpResponseMessage? response, CancellationToken cancellationToken)
        {
            var result = await base.TransformResponseAsync(context, response, cancellationToken);
            context.Response.Headers.Remove("Set-Cookie");
            return result;
        }
    }
}
