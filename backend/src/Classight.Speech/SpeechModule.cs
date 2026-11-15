using Classight.SharedKernel;
using Classight.Platform;
using Classight.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Classight.Speech;

public sealed class SpeechModule : IPluginModule
{
    public string Name => "Speech";
    public PluginManifest Manifest => new("meetings", "Class meetings", "Submission review, assigned groups and live presentations", "1.1.0", WorkspacePath: "meetings", Icon: "mic");
    public IEnumerable<PermissionDefinition> DeclarePermissions() => new[]
    {
        new PermissionDefinition("speech.participate", Name, "报名排队、组队、上交课件"),
        new PermissionDefinition("speech.manage", Name, "管理场次、审核报名、指定小组及对外展示")
    };
    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IManagedPlugin>(new ManagedPlugin("meetings", true));
        services.AddScoped<SpeechService>(); services.AddScoped<CoursewareService>();
        services.AddSingleton<CoursewareStore>(); services.AddSingleton<PreviewTokens>(); services.AddSingleton<ConversionQueue>();
        services.AddSingleton<IPresentationConverter, SofficeConverter>();
        services.AddHostedService<ConversionWorker>();
    }
    public void MapEndpoints(IEndpointRouteBuilder endpoints)
    {
        var speech = endpoints.MapGroup("/api/v1/speech").WithTags("Speech").RequireAuthorization();
        speech.MapGet("/capabilities", ([FromServices] SpeechService service, CancellationToken ct) => service.Capabilities(ct));
        speech.MapGet("/sessions", ([FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.ListSessions(http.Request, false, ct));
        speech.MapGet("/sessions/{id:guid}", (Guid id, [FromServices] SpeechService service, CancellationToken ct) => service.GetSession(id, ct));
        speech.MapPost("/sessions/{id:guid}/entries", async (Guid id, [FromBody] EntryCreateRequest body, [FromServices] SpeechService service, CancellationToken ct) =>
            Results.Created($"/api/v1/speech/sessions/{id}", await service.SignUp(id, body, ct))).RequireAuthorization("speech.participate");
        speech.MapPatch("/entries/{id:guid}", (Guid id, [FromBody] EntryPatchRequest body, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.PatchEntry(id, body, http, ct));
        speech.MapDelete("/entries/{id:guid}", async (Guid id, [FromServices] SpeechService service, CancellationToken ct) => { await service.DeleteEntry(id, ct); return Results.NoContent(); });
        speech.MapPost("/sessions/{id:guid}/teams", async (Guid id, [FromBody] TeamCreateRequest body, [FromServices] SpeechService service, CancellationToken ct) =>
            Results.Created($"/api/v1/speech/sessions/{id}", await service.CreateTeam(id, body, ct))).RequireAuthorization("speech.participate");
        speech.MapPost("/teams/join", ([FromBody] TeamJoinRequest body, [FromServices] SpeechService service, CancellationToken ct) => service.JoinTeam(body, ct)).RequireAuthorization("speech.participate");
        speech.MapDelete("/teams/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, [FromServices] SpeechService service, CancellationToken ct) => { await service.RemoveMember(id, userId, ct); return Results.NoContent(); });
        speech.MapDelete("/teams/{id:guid}", async (Guid id, [FromServices] SpeechService service, CancellationToken ct) => { await service.DisbandTeam(id, ct); return Results.NoContent(); });

        speech.MapPost("/entries/{id:guid}/courseware", async (Guid id, [FromServices] CoursewareService service, HttpContext http, CancellationToken ct) =>
        {
            var view = await service.Upload(id, http, ct); return Results.Created($"/api/v1/speech/courseware/{view.Id}", view);
        }).Accepts<IFormFile>("multipart/form-data").DisableAntiforgery();
        speech.MapGet("/courseware/{id:guid}", (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => service.Get(id, ct));
        speech.MapGet("/courseware/{id:guid}/download", (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => service.Download(id, ct)).RequireAuthorization("speech.manage");
        speech.MapGet("/courseware/{id:guid}/preview", (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => service.InternalPreview(id, ct));
        speech.MapDelete("/courseware/{id:guid}", async (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => { await service.Delete(id, ct); return Results.NoContent(); });

        var preview = endpoints.MapGroup("/api/v1/speech/preview/{token}").WithTags("Speech Preview").AllowAnonymous();
        preview.MapGet("/status", (string token, [FromServices] CoursewareService service, CancellationToken ct) => service.DisplayStatus(token, ct));
        preview.MapGet("/file", (string token, [FromServices] CoursewareService service, HttpContext http, CancellationToken ct) => service.PreviewFile(token, http, ct));
        preview.MapGet("/site/{**path}", (string token, string? path, [FromServices] CoursewareService service, HttpContext http, CancellationToken ct) => service.PreviewSite(token, path, http, ct));

        var admin = endpoints.MapGroup("/api/v1/admin/speech").WithTags("Admin Speech").RequireAuthorization("speech.manage");
        admin.MapGet("/sessions", ([FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.ListSessions(http.Request, true, ct));
        admin.MapPost("/sessions", async ([FromBody] SessionWriteRequest body, [FromServices] SpeechService service, CancellationToken ct) =>
        {
            var view = await service.CreateSession(body, ct); return Results.Created($"/api/v1/speech/sessions/{view.Id}", view);
        });
        admin.MapPut("/sessions/{id:guid}", (Guid id, [FromBody] SessionWriteRequest body, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.UpdateSession(id, body, http, ct));
        admin.MapDelete("/sessions/{id:guid}", async (Guid id, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => { await service.DeleteSession(id, http, ct); return Results.NoContent(); });
        admin.MapPost("/sessions/{id:guid}/status", (Guid id, [FromBody] StatusRequest body, [FromServices] SpeechService service, CancellationToken ct) => service.SetStatus(id, body, ct));
        admin.MapPut("/sessions/{id:guid}/order", (Guid id, [FromBody] OrderRequest body, [FromServices] SpeechService service, CancellationToken ct) => service.SetOrder(id, body, ct));
        admin.MapPost("/entries/{id:guid}/start", (Guid id, [FromServices] SpeechService service, CancellationToken ct) => service.Start(id, ct));
        admin.MapPost("/entries/{id:guid}/finish", (Guid id, [FromServices] SpeechService service, CancellationToken ct) => service.Finish(id, ct));
        admin.MapPost("/entries/{id:guid}/skip", (Guid id, [FromServices] SpeechService service, CancellationToken ct) => service.Skip(id, ct));
        admin.MapPut("/entries/{id:guid}/review", (Guid id, [FromBody] EntryReviewRequest body, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.Review(id, body, http, ct));
        admin.MapPost("/courseware/{id:guid}/display", (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => service.StartDisplay(id, ct));
        admin.MapDelete("/entries/{id:guid}/display", async (Guid id, [FromServices] CoursewareService service, CancellationToken ct) => { await service.StopDisplay(id, ct); return Results.NoContent(); });
        admin.MapGet("/sessions/{id:guid}/group-candidates", (Guid id, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.GroupCandidates(id, http.Request, ct));
        admin.MapPost("/sessions/{id:guid}/teams", (Guid id, [FromBody] AssignedTeamRequest body, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.AssignTeam(id, null, body, http, ct));
        admin.MapPut("/sessions/{id:guid}/teams/{teamId:guid}", (Guid id, Guid teamId, [FromBody] AssignedTeamRequest body, [FromServices] SpeechService service, HttpContext http, CancellationToken ct) => service.AssignTeam(id, teamId, body, http, ct));
        admin.MapPost("/sessions/{id:guid}/entries", async (Guid id, [FromBody] AdminEntryCreateRequest body, [FromServices] SpeechService service, CancellationToken ct) =>
            Results.Created($"/api/v1/speech/sessions/{id}", await service.AdminSignUp(id, body, ct)));
    }
}
