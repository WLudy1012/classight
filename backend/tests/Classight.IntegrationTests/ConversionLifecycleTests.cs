using Classight.Contracts;
using Classight.Platform;
using Classight.Speech;
using Classight.SharedKernel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class ConversionLifecycleTests
{
    private sealed class ContendedLock : IDistributedLock
    {
        private readonly LocalLock inner = new();
        private int attempts;
        public ValueTask<IAsyncDisposable> Acquire(string key, CancellationToken ct) => Interlocked.Increment(ref attempts) == 1
            ? ValueTask.FromException<IAsyncDisposable>(new ApiException(503, "dependency.unavailable", "Lock held by previous generation"))
            : inner.Acquire(key, ct);
    }

    private sealed class Converter : IPresentationConverter
    {
        public bool Available => true;
        public string? Command => "test";
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls;
        public int Concurrent;
        public int MaximumConcurrent;
        public async Task<string?> ConvertToPdf(string inputPath, string workDirectory, CancellationToken ct)
        {
            var calls = Interlocked.Increment(ref Calls);
            var active = Interlocked.Increment(ref Concurrent);
            MaximumConcurrent = Math.Max(MaximumConcurrent, active);
            try
            {
                if (calls == 1)
                {
                    Started.TrySetResult();
                    await Task.Delay(Timeout.Infinite, ct);
                }
                var path = Path.Combine(workDirectory, "output.pdf");
                await File.WriteAllTextAsync(path, "%PDF-1.4", ct);
                return path;
            }
            finally { Interlocked.Decrement(ref Concurrent); }
        }
    }

    [Fact]
    public async Task A_new_generation_waits_for_the_old_conversion_and_resumes_cancelled_work()
    {
        var root = Path.Combine(Path.GetTempPath(), "classight-conversion-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var converter = new Converter();
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Storage:LocalPath"] = root }).Build());
            services.AddDbContext<AppDbContext>(options => options.UseSqlite("Data Source=" + Path.Combine(root, "test.db") + ";Pooling=False"));
            services.AddSingleton<CoursewareStore>();
            services.AddSingleton<IPresentationConverter>(converter);
            services.AddSingleton<IDistributedLock, ContendedLock>();
            await using var provider = services.BuildServiceProvider();
            var id = Guid.NewGuid();
            await using (var scope = provider.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Database.EnsureCreatedAsync();
                var session = new MeetingSession { Title = "test" };
                var entry = new SpeechEntry { SessionId = session.Id, OwnerId = Guid.NewGuid() };
                db.MeetingSessions.Add(session);
                db.SpeechEntries.Add(entry);
                db.Coursewares.Add(new Courseware { Id = id, EntryId = entry.Id, Kind = "pptx", ConversionStatus = "converting" });
                await db.SaveChangesAsync();
            }
            var store = provider.GetRequiredService<CoursewareStore>();
            Directory.CreateDirectory(store.Dir(id));
            await File.WriteAllTextAsync(store.OriginalPath(id), "presentation");
            var firstQueue = new ConversionQueue();
            var secondQueue = new ConversionQueue();
            using var first = ActivatorUtilities.CreateInstance<ConversionWorker>(provider, firstQueue);
            using var second = ActivatorUtilities.CreateInstance<ConversionWorker>(provider, secondQueue);
            var timeout = TimeSpan.FromSeconds(30);
            try
            {
                await first.StartAsync(default);
                await converter.Started.Task.WaitAsync(timeout);
                await second.StartAsync(default);
                secondQueue.Enqueue(id);
                await first.StopAsync(default);
                using var deadline = new CancellationTokenSource(timeout);
                string? status;
                do
                {
                    await Task.Delay(20, deadline.Token);
                    await using var scope = provider.CreateAsyncScope();
                    status = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Coursewares.AsNoTracking().Where(item => item.Id == id).Select(item => item.ConversionStatus).SingleAsync(deadline.Token);
                } while (status == "converting");
                Assert.Equal("ready", status);
            }
            finally
            {
                await second.StopAsync(default);
                await first.StopAsync(default);
            }
            Assert.Equal(1, converter.MaximumConcurrent);
            Assert.Equal(2, converter.Calls);
            Assert.True(File.Exists(store.PdfPath(id)));
        }
        finally { Directory.Delete(root, true); }
    }
}
