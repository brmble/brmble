using System.Text.Json;
using Brmble.Server.Auth;

namespace Brmble.Server.LiveKit;

public static class LiveKitEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/livekit/token", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            LiveKitService liveKitService,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop)
                    ? prop.GetString() : null;
            }
            catch { /* invalid JSON */ }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            var token = await liveKitService.GenerateToken(certHash, roomName);
            if (token is null)
                return Results.Unauthorized();

            // Build the LiveKit WebSocket URL relative to the request origin.
            // LiveKit is proxied through YARP at /livekit/, so the client connects
            // to the same host using the /livekit path prefix.
            var request = httpContext.Request;
            var wsScheme = request.Scheme == "https" ? "wss" : "ws";
            var url = $"{wsScheme}://{request.Host}/livekit";

            return Results.Ok(new { token, url });
        });

        return app;
    }
}
