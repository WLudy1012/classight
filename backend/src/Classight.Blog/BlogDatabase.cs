using Microsoft.EntityFrameworkCore;

namespace Classight.Blog;

public sealed class BlogPost
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AuthorId { get; set; }
    public string AuthorName { get; set; } = "";
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Body { get; set; } = "";
    public long UpdatedAt { get; set; }
    public long? PublishedAt { get; set; }
    public long Version { get; set; } = 1;
}

public sealed class BlogDatabase(DbContextOptions<BlogDatabase> options) : DbContext(options)
{
    public DbSet<BlogPost> Posts => Set<BlogPost>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        var post = model.Entity<BlogPost>().ToTable("classight_blog_posts");
        post.Property(x => x.Id).HasConversion<string>().ValueGeneratedNever();
        post.Property(x => x.AuthorId).HasConversion<string>();
        post.Property(x => x.Version).IsConcurrencyToken();
    }

    public static string[] Schema(string? provider)
    {
        var mysql = provider == "Pomelo.EntityFrameworkCore.MySql";
        var table = """
            CREATE TABLE IF NOT EXISTS classight_blog_posts (
                "Id" VARCHAR(36) NOT NULL PRIMARY KEY,
                "AuthorId" VARCHAR(36) NOT NULL,
                "AuthorName" VARCHAR(200) NOT NULL,
                "Title" VARCHAR(160) NOT NULL,
                "Summary" VARCHAR(280) NOT NULL,
                "Body" TEXT NOT NULL,
                "UpdatedAt" BIGINT NOT NULL,
                "PublishedAt" BIGINT NULL,
                "Version" BIGINT NOT NULL
            """;
        return mysql
            ? [(table.Replace('"', '`') + ", INDEX blog_published (`PublishedAt`, `Id`), INDEX blog_author (`AuthorId`, `UpdatedAt`, `Id`)) DEFAULT CHARSET=utf8mb4")]
            : [table + ")", "CREATE INDEX IF NOT EXISTS blog_published ON classight_blog_posts (\"PublishedAt\", \"Id\")", "CREATE INDEX IF NOT EXISTS blog_author ON classight_blog_posts (\"AuthorId\", \"UpdatedAt\", \"Id\")"];
    }
}
