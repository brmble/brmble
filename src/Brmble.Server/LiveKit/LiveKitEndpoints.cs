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
            string? accessModeRaw = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var roomProp)
                    ? roomProp.GetString()
                    : null;
                accessModeRaw = doc.RootElement.TryGetProperty("accessMode", out var modeProp)
                    ? modeProp.GetString()
                    : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse LiveKit token request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            LiveKitAccessMode? accessMode = accessModeRaw?.Trim().ToLowerInvariant() switch
            {
                "publish" => LiveKitAccessMode.Publish,
                "subscribe" => LiveKitAccessMode.Subscribe,
                _ => null,
            };

            if (accessMode is null)
                return Results.BadRequest(new { error = "accessMode must be 'publish' or 'subscribe'" });

            var token = await liveKitService.GenerateToken(certHash, roomName, accessMode.Value);
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
            ISessionMappingService sessionMapping,
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

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            if (!tracker.Start(roomName, user.DisplayName, user.Id, user.MatrixUserId))
                return Results.Conflict(new { error = "user is already sharing in this room" });

            var hasSession = sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId);
            await eventBus.BroadcastAsync(new
            {
                type = "screenShare.started",
                roomName,
                userName = user.DisplayName,
                userId = user.Id,
                matrixUserId = user.MatrixUserId,
                sessionId = hasSession ? sessionId : (int?)null
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

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            tracker.StopByUserId(roomName, user.Id);
            await eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = user.Id });
            return Results.Ok();
        });

        app.MapGet("/livekit/active-share", (
            HttpContext httpContext,
            ScreenShareTracker tracker,
            ISessionMappingService sessionMapping) =>
        {
            var roomName = httpContext.Request.Query["roomName"].ToString();
            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName query parameter is required" });

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            var shares = tracker.GetActiveShares(roomName);
            var result = shares.Select(s =>
            {
                var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
                return new { s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
            }).ToArray();
            return Results.Ok(new { shares = result });
        });

        return app;
    }
}
