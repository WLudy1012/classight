using Classight.Platform;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Blog;

public sealed record BlogWrite(string? Title, string? Summary, string? Body, bool Published, long? Version);
public sealed record ArticleSummary(Guid Id, Guid AuthorId, string AuthorName, string Title, string Summary, DateTimeOffset UpdatedAt, DateTimeOffset? PublishedAt, long Version);
public sealed record Article(ArticleSummary Info, string Body);

public sealed class BlogModule : IPluginModule
{
    private const string Id = "blog";
    public string Name => "Blog";
    public PluginManifest Manifest => new(Id, "Class blog", "Class articles and personal drafts", "1.0.0", WorkspacePath: Id, Permission: "blog.read", Icon: "file");
    public IEnumerable<PermissionDefinition> DeclarePermissions() =>
        [new("blog.read", Name, "阅读班级博客"), new("blog.write", Name, "撰写和发布自己的文章"), new("blog.moderate", Name, "移除班级博客文章")];

    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IManagedPlugin>(new ManagedPlugin(Id, true));
        services.AddPluginDatabase<BlogDatabase>(options => new(options), BlogDatabase.Schema);
        services.AddScoped<BlogService>();
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var routes = endpoints.MapGroup("/api/v1/plugins/blog/api/posts").RequireAuthorization("blog.read").WithTags("Blog");
        routes.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var services = http.RequestServices;
            if (!await services.GetRequiredService<PluginStateStore>().IsEnabled(Id, http.RequestAborted)) throw ApiException.NotFound();
            await services.GetRequiredService<PluginDatabase.Schema<BlogDatabase>>().Ensure(services.GetRequiredService<BlogDatabase>(), http.RequestAborted);
            return await next(context);
        });
        routes.MapGet("", ([FromServices] BlogService blog, HttpRequest request, CancellationToken ct) => blog.List(request, ct));
        routes.MapGet("/{id:guid}", (Guid id, [FromServices] BlogService blog, CancellationToken ct) => blog.Read(id, ct));
        routes.MapPost("", async ([FromBody] BlogWrite input, [FromServices] BlogService blog, HttpContext http, CancellationToken ct) =>
        {
            var article = await blog.Save(null, input, http, ct);
            return Results.Created($"/api/v1/plugins/blog/api/posts/{article.Info.Id}", article);
        }).RequireAuthorization("blog.write");
        routes.MapPut("/{id:guid}", (Guid id, [FromBody] BlogWrite input, [FromServices] BlogService blog, HttpContext http, CancellationToken ct) => blog.Save(id, input, http, ct)).RequireAuthorization("blog.write");
        routes.MapDelete("/{id:guid}", async (Guid id, long? version, [FromServices] BlogService blog, HttpContext http, CancellationToken ct) =>
        {
            await blog.Delete(id, version, http, ct);
            return Results.NoContent();
        });
    }
}

public sealed class BlogService(BlogDatabase blog, AppDbContext users, ICurrentUser current, IClock clock, IEventBus events)
{
    private Guid Me => current.Id ?? throw ApiException.Forbidden();
    private static ArticleSummary Summary(BlogPost item) => new(item.Id, item.AuthorId, item.AuthorName, item.Title, item.Summary,
        DateTimeOffset.FromUnixTimeMilliseconds(item.UpdatedAt), item.PublishedAt is long published ? DateTimeOffset.FromUnixTimeMilliseconds(published) : null, item.Version);

    public async Task<Page<ArticleSummary>> List(HttpRequest request, CancellationToken ct)
    {
        var (page, size) = Input.Paging(request);
        var mine = request.Query["scope"].ToString() switch
        {
            "" or "published" => false,
            "mine" => true,
            _ => throw ApiException.Validation("scope", "无效的文章范围")
        };
        var search = Input.Optional(request.Query["q"].ToString(), "q", 100);
        var query = blog.Posts.AsNoTracking();
        if (mine) query = query.Where(x => x.AuthorId == Me);
        else query = query.Where(x => x.PublishedAt != null);
        if (!string.IsNullOrEmpty(search))
        {
            var term = search.ToLowerInvariant();
            query = query.Where(x => x.Title.ToLower().Contains(term) || x.Summary.ToLower().Contains(term));
        }
        var total = await query.CountAsync(ct);
        var items = await (mine ? query.OrderByDescending(x => x.UpdatedAt) : query.OrderByDescending(x => x.PublishedAt))
            .ThenByDescending(x => x.Id).Skip((page - 1) * size).Take(size).ToListAsync(ct);
        return new(items.Select(Summary).ToArray(), total, page, size);
    }

    private async Task<BlogPost> Find(Guid id, CancellationToken ct)
    {
        var item = await blog.Posts.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        if (item.PublishedAt is null && item.AuthorId != Me) throw ApiException.NotFound();
        return item;
    }

    public async Task<Article> Read(Guid id, CancellationToken ct)
    {
        var item = await Find(id, ct);
        return new(Summary(item), item.Body);
    }

    public async Task<Article> Save(Guid? id, BlogWrite input, HttpContext http, CancellationToken ct)
    {
        var updated = clock.UtcNow.ToUnixTimeMilliseconds();
        BlogPost item;
        if (id is Guid existing)
        {
            item = await Find(existing, ct);
            if (item.AuthorId != Me) throw ApiException.Forbidden();
            Input.Version(http, input.Version, item.Version);
            item.Version++;
        }
        else
        {
            var name = await users.Users.AsNoTracking().Where(x => x.Id == Me && !x.Disabled && !x.Deleted).Select(x => x.DisplayName).SingleOrDefaultAsync(ct) ?? throw ApiException.Forbidden();
            item = new() { AuthorId = Me, AuthorName = name };
            blog.Posts.Add(item);
        }
        item.Title = Input.Required(input.Title, "title", 160);
        item.Summary = Input.Optional(input.Summary, "summary", 280) ?? "";
        item.Body = input.Published ? Input.Required(input.Body, "body", 16_000) : Input.Optional(input.Body, "body", 16_000) ?? "";
        item.UpdatedAt = updated;
        item.PublishedAt = input.Published ? item.PublishedAt ?? updated : null;
        await blog.SaveChangesAsync(ct);
        return new(Summary(item), item.Body);
    }

    public async Task Delete(Guid id, long? version, HttpContext http, CancellationToken ct)
    {
        var item = await Find(id, ct);
        if (!(item.AuthorId == Me && current.Can("blog.write")) && !(item.PublishedAt != null && current.Can("blog.moderate"))) throw ApiException.Forbidden();
        Input.Version(http, version, item.Version);
        blog.Posts.Remove(item);
        await blog.SaveChangesAsync(ct);
        await events.Publish(new("blog.post.deleted", "BlogPost", id.ToString(), new { item.AuthorId }, null), ct);
    }
}
