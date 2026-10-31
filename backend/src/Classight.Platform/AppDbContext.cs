using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Classight.Platform;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<UsedRefreshToken> UsedRefreshTokens => Set<UsedRefreshToken>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<ClassProfile> ClassProfiles => Set<ClassProfile>();
    public DbSet<Member> Members => Set<Member>();
    public DbSet<TimelineEvent> Timeline => Set<TimelineEvent>();
    public DbSet<MediaAsset> Media => Set<MediaAsset>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<AuditEntry> AuditLogs => Set<AuditEntry>();
    public DbSet<ActivityEntry> Activities => Set<ActivityEntry>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<MeetingSession> MeetingSessions => Set<MeetingSession>();
    public DbSet<SpeechTeam> SpeechTeams => Set<SpeechTeam>();
    public DbSet<SpeechTeamMember> SpeechTeamMembers => Set<SpeechTeamMember>();
    public DbSet<SpeechEntry> SpeechEntries => Set<SpeechEntry>();
    public DbSet<Courseware> Coursewares => Set<Courseware>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        foreach (var type in typeof(Entity).Assembly.GetTypes().Where(t => t.IsSubclassOf(typeof(Entity))))
        {
            var entity = model.Entity(type);
            entity.HasKey(nameof(Entity.Id));
            entity.Property(nameof(Entity.Version)).IsConcurrencyToken();
            entity.Property(nameof(Entity.CreatedAt)).HasConversion(new DateTimeOffsetToBinaryConverter());
        }
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
            {
                if (property.ClrType == typeof(string)) property.SetMaxLength(2000);
                if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?)) property.SetValueConverter(new DateTimeOffsetToBinaryConverter());
            }
        model.Entity<User>().HasIndex(x => x.NormalizedUsername).IsUnique();
        model.Entity<User>().Property(x => x.NormalizedUsername).HasMaxLength(64);
        model.Entity<User>().HasIndex(x => x.NormalizedEmail).IsUnique();
        model.Entity<User>().Property(x => x.NormalizedEmail).HasMaxLength(254);
        model.Entity<Role>().HasIndex(x => x.Name).IsUnique();
        model.Entity<Role>().Property(x => x.Name).HasMaxLength(64);
        model.Entity<Session>().HasIndex(x => x.RefreshHash).IsUnique();
        model.Entity<Session>().Property(x => x.RefreshHash).HasMaxLength(64);
        model.Entity<Session>().HasIndex(x => x.UserId);
        model.Entity<UsedRefreshToken>().HasIndex(x => x.Hash).IsUnique();
        model.Entity<UsedRefreshToken>().Property(x => x.Hash).HasMaxLength(64);
        model.Entity<Invite>().HasIndex(x => x.Code).IsUnique();
        model.Entity<Invite>().Property(x => x.Code).HasMaxLength(64);
        model.Entity<Member>().HasIndex(x => x.UserId).IsUnique();
        model.Entity<Setting>().HasIndex(x => x.Group).IsUnique();
        model.Entity<Setting>().Property(x => x.Group).HasMaxLength(32);
        model.Entity<UserRole>().HasKey(x => new { x.UserId, x.RoleId });
        model.Entity<UserRole>().HasOne(x => x.User).WithMany(x => x.UserRoles).HasForeignKey(x => x.UserId);
        model.Entity<UserRole>().HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId);
        model.Entity<Invite>().HasOne<Role>().WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);
        JsonArray(model.Entity<Role>().Property(x => x.Permissions));
        JsonArray(model.Entity<TimelineEvent>().Property(x => x.Tags));
        JsonArray(model.Entity<TimelineEvent>().Property(x => x.Media));
        model.Entity<Setting>().Property(x => x.Json).HasColumnType("text");
        model.Entity<ClassProfile>().Property(x => x.Intro).HasColumnType("text");
        model.Entity<TimelineEvent>().Property(x => x.Body).HasColumnType("text");
        model.Entity<AuditEntry>().Property(x => x.Before).HasColumnType("text");
        model.Entity<AuditEntry>().Property(x => x.After).HasColumnType("text");
        model.Entity<ActivityEntry>().Property(x => x.Payload).HasColumnType("text");
        SpeechModel(model);
    }
    private static void SpeechModel(ModelBuilder model)
    {
        model.Entity<MeetingSession>().Property(x => x.Title).HasMaxLength(200);
        model.Entity<MeetingSession>().Property(x => x.Status).HasMaxLength(16);
        model.Entity<MeetingSession>().Property(x => x.Description).HasColumnType("text");
        model.Entity<MeetingSession>().HasIndex(x => x.Date);
        model.Entity<SpeechTeam>().Property(x => x.Name).HasMaxLength(100);
        model.Entity<SpeechTeam>().Property(x => x.JoinCode).HasMaxLength(16);
        model.Entity<SpeechTeam>().HasIndex(x => x.JoinCode).IsUnique();
        model.Entity<SpeechTeam>().HasIndex(x => x.SessionId);
        model.Entity<SpeechTeam>().HasOne<MeetingSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<SpeechTeamMember>().HasIndex(x => new { x.SessionId, x.UserId }).IsUnique();
        model.Entity<SpeechTeamMember>().HasIndex(x => x.TeamId);
        model.Entity<SpeechTeamMember>().HasOne<SpeechTeam>().WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<SpeechEntry>().Property(x => x.Topic).HasMaxLength(200);
        model.Entity<SpeechEntry>().Property(x => x.Status).HasMaxLength(16);
        model.Entity<SpeechEntry>().HasIndex(x => new { x.SessionId, x.OwnerId }).IsUnique();
        model.Entity<SpeechEntry>().HasIndex(x => x.TeamId).IsUnique();
        model.Entity<SpeechEntry>().HasIndex(x => new { x.SessionId, x.Position });
        model.Entity<SpeechEntry>().HasOne<MeetingSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<SpeechEntry>().HasOne<SpeechTeam>().WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.SetNull);
        model.Entity<Courseware>().Property(x => x.Kind).HasMaxLength(16);
        model.Entity<Courseware>().Property(x => x.OriginalName).HasMaxLength(255);
        model.Entity<Courseware>().Property(x => x.StorageKey).HasMaxLength(64);
        model.Entity<Courseware>().Property(x => x.ConversionStatus).HasMaxLength(16);
        model.Entity<Courseware>().Property(x => x.PdfKey).HasMaxLength(64);
        model.Entity<Courseware>().Property(x => x.WebEntry).HasMaxLength(255);
        model.Entity<Courseware>().HasIndex(x => x.EntryId).IsUnique();
        model.Entity<Courseware>().HasOne<SpeechEntry>().WithMany().HasForeignKey(x => x.EntryId).OnDelete(DeleteBehavior.Cascade);
    }
    private static void JsonArray<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.PropertyBuilder<T[]> property)
    {
        property.HasConversion(v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null), v => JsonSerializer.Deserialize<T[]>(v, (JsonSerializerOptions?)null) ?? Array.Empty<T>()).HasColumnType("text");
        property.Metadata.SetValueComparer(new ValueComparer<T[]>((a, b) => a!.SequenceEqual(b!), a => a.Aggregate(0, (h, v) => HashCode.Combine(h, v)), a => a.ToArray()));
    }
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<Entity>().Where(x => x.State == EntityState.Modified)) entry.Entity.Version++;
        return base.SaveChangesAsync(ct);
    }
}
