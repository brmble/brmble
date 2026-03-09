using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;

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
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse LiveKit token request body"); }

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

        app.MapPost("/livekit/share-started", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ScreenShareTracker tracker,
            IBrmbleEventBus eventBus,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop) ? prop.GetString() : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-started request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            tracker.Start(roomName, user.DisplayName, user.MatrixUserId);
            await eventBus.BroadcastAsync(new
            {
                type = "screenShare.started",
                roomName,
                userName = user.DisplayName,
                matrixUserId = user.MatrixUserId
            });
            return Results.Ok();
        });

        app.MapPost("/livekit/share-stopped", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ScreenShareTracker tracker,
            IBrmbleEventBus eventBus,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop) ? prop.GetString() : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-stopped request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            var activeShare = tracker.GetActive(roomName);
            if (activeShare is null)
                return Results.BadRequest(new { error = "no active screen share for room" });

            if (activeShare.MatrixUserId != user.MatrixUserId)
                return Results.Forbid();

            tracker.Stop(roomName);
            await eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName });
            return Results.Ok();
        });

        app.MapGet("/livekit/active-share", (
            HttpContext httpContext,
            ScreenShareTracker tracker) =>
        {
            var roomName = httpContext.Request.Query["roomName"].ToString();
            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName query parameter is required" });

            var info = tracker.GetActive(roomName);
            return info is not null
                ? Results.Ok(new { info.UserName, info.MatrixUserId })
                : Results.NotFound();
        });

        return app;
    }
}
