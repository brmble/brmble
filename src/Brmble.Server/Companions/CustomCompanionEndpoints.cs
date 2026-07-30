namespace Brmble.Server.Companions;

public static class CustomCompanionEndpoints
{
    public static IEndpointRouteBuilder MapCustomCompanionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/companions", async (
            CustomCompanionCreateRequest request,
            HttpContext httpContext,
            CustomCompanionUploadService uploadService,
            CancellationToken cancellationToken) =>
                await uploadService.CreateAsync(httpContext, request, cancellationToken))
            .RequireRateLimiting("custom-companion-upload");

        return app;
    }
}
