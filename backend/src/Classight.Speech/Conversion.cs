using System.Diagnostics;
using System.Threading.Channels;
using Classight.Platform;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Classight.Speech;

/// <summary>Converts a presentation to PDF. Implementations must be safe to call from a single background worker.</summary>
public interface IPresentationConverter
{
    bool Available { get; }
    string? Command { get; }
    /// <summary>Converts <paramref name="inputPath"/> (extension .ppt or .pptx) and returns the path of the produced PDF, or null on failure.</summary>
    Task<string?> ConvertToPdf(string inputPath, string workDirectory, CancellationToken ct);
}

public sealed class SofficeConverter(IConfiguration config, ILogger<SofficeConverter> logger) : IPresentationConverter
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(120);
    private readonly Lazy<string?> command = new(() => Resolve(config));
    public bool Available => command.Value is not null;
    public string? Command => command.Value;

    private static string? Resolve(IConfiguration config)
    {
        var configured = config["Courseware:Converter:Command"];
        if (!string.IsNullOrWhiteSpace(configured)) return File.Exists(configured) ? configured : FindOnPath(configured);
        foreach (var name in new[] { "soffice", "libreoffice" }) if (FindOnPath(name) is { } found) return found;
        if (OperatingSystem.IsWindows())
            foreach (var root in new[] { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)") })
                if (root is not null && Path.Combine(root, "LibreOffice", "program", "soffice.exe") is var candidate && File.Exists(candidate)) return candidate;
        return null;
    }
    private static string? FindOnPath(string name)
    {
        var extensions = OperatingSystem.IsWindows() ? new[] { ".exe", ".cmd", ".bat", "" } : new[] { "" };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            foreach (var extension in extensions)
            {
                try { var candidate = Path.Combine(directory.Trim('"'), name + extension); if (File.Exists(candidate)) return candidate; } catch (ArgumentException) { }
            }
        return null;
    }

    public async Task<string?> ConvertToPdf(string inputPath, string workDirectory, CancellationToken ct)
    {
        var exe = command.Value; if (exe is null) return null;
        var profile = Path.Combine(workDirectory, "profile");
        var info = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var argument in new[] { "-env:UserInstallation=" + new Uri(profile).AbsoluteUri, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", workDirectory, inputPath }) info.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = info };
        process.Start();
        _ = process.StandardOutput.ReadToEndAsync(CancellationToken.None); _ = process.StandardError.ReadToEndAsync(CancellationToken.None);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(Timeout);
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            logger.LogWarning("Presentation conversion timed out or was cancelled");
            return null;
        }
        var output = Path.Combine(workDirectory, Path.GetFileNameWithoutExtension(inputPath) + ".pdf");
        if (process.ExitCode != 0 || !File.Exists(output)) { logger.LogWarning("Presentation converter exited with {Code}", process.ExitCode); return null; }
        return output;
    }
}

public sealed class ConversionQueue
{
    private readonly Channel<Guid> channel = Channel.CreateUnbounded<Guid>(new() { SingleReader = true });
    public bool Enqueue(Guid coursewareId) => channel.Writer.TryWrite(coursewareId);
    public IAsyncEnumerable<Guid> ReadAll(CancellationToken ct) => channel.Reader.ReadAllAsync(ct);
}

public sealed class ConversionWorker(ConversionQueue queue, IServiceScopeFactory scopes, CoursewareStore store, IPresentationConverter converter, ILogger<ConversionWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!converter.Available) return;
        _ = Task.Run(() => Requeue(stoppingToken), stoppingToken);
        await foreach (var id in queue.ReadAll(stoppingToken))
        {
            try { await Convert(id, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogError(ex, "Courseware conversion crashed for {Id}", id); await Mark(id, "failed", null, stoppingToken); }
        }
    }

    private async Task Requeue(CancellationToken ct)
    {
        for (var attempt = 0; attempt < 60 && !ct.IsCancellationRequested; attempt++)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                foreach (var id in await db.Coursewares.AsNoTracking().Where(x => x.ConversionStatus == "converting").Select(x => x.Id).ToListAsync(ct)) queue.Enqueue(id);
                return;
            }
            catch (Exception) when (!ct.IsCancellationRequested) { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
        }
    }

    private async Task Convert(Guid id, CancellationToken ct)
    {
        var kind = await KindOf(id, ct);
        if (kind is not ("ppt" or "pptx") || !File.Exists(store.OriginalPath(id))) return;
        var work = Path.Combine(store.Dir(id), "work");
        string? result = null;
        try
        {
            Directory.CreateDirectory(work);
            var source = Path.Combine(work, "source." + (kind == "ppt" ? "ppt" : "pptx"));
            File.Copy(store.OriginalPath(id), source, true);
            var pdf = await converter.ConvertToPdf(source, work, ct);
            if (pdf is not null && File.Exists(pdf)) { File.Move(pdf, store.PdfPath(id), true); result = "converted.pdf"; }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { logger.LogWarning(ex, "Courseware conversion IO failure for {Id}", id); }
        finally { try { if (Directory.Exists(work)) Directory.Delete(work, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        if (!await Mark(id, result is null ? "failed" : "ready", result, ct) && result is not null) File.Delete(store.PdfPath(id));
    }

    private async Task<string?> KindOf(Guid id, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Coursewares.AsNoTracking().Where(x => x.Id == id).Select(x => x.Kind).SingleOrDefaultAsync(ct);
    }

    /// <summary>Updates the conversion state. Returns false when the courseware no longer exists (replaced or deleted meanwhile).</summary>
    private async Task<bool> Mark(Guid id, string status, string? pdfKey, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var item = await db.Coursewares.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (item is null) return false;
        item.ConversionStatus = status; item.PdfKey = pdfKey;
        await db.SaveChangesAsync(ct);
        return true;
    }
}
