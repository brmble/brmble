using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Microsoft.AspNetCore.Http;

namespace Brmble.Server.LiveKit;

public static class LiveKitEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/livekit/token", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            LiveKitService liveKitService,
            UserRepository userRepo,
            ISessionMappingService sessionMapping,
            IChannelMembershipService channelMembership,
            LiveKitParticipantTracker participantTracker,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
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

            var hasSession = sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId);
            var isInRequestedRoom = hasSession
                && channelMembership.TryGetChannel(sessionId, out var channelId)
                && string.Equals(roomName, $"channel-{channelId}", StringComparison.Ordinal);

            var authz = await liveKitService.AuthorizeTokenRequest(
                certHash,
                roomName,
                accessMode.Value,
                canPublish: isInRequestedRoom,
                canSubscribe: isInRequestedRoom);

            if (!authz.Allowed)
            {
                return authz.Failure switch
                {
                    LiveKitAuthorizationFailure.Unauthorized => Results.Unauthorized(),
                    LiveKitAuthorizationFailure.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
                    LiveKitAuthorizationFailure.InvalidRoom => Results.BadRequest(new { error = "invalid roomName format" }),
                    _ => Results.StatusCode(StatusCodes.Status403Forbidden),
                };
            }

            var issuedAt = DateTimeOffset.UtcNow;
            var metadata = await liveKitService.GenerateTokenMetadata(certHash, roomName, accessMode.Value, issuedAt);
            if (metadata is null)
                return Results.Unauthorized();

            if (hasSession)
            {
                participantTracker.PruneExpired(issuedAt);
                var recorded = participantTracker.TryUpsert(new LiveKitParticipantRecord(
                    roomName,
                    user.MatrixUserId,
                    user.Id,
                    sessionId,
                    accessMode.Value,
                    metadata.ExpiresAt));
                if (!recorded)
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            // Build the LiveKit WebSocket URL relative to the request origin.
            // LiveKit is proxied through YARP at /livekit/, so the client connects
            // to the same host using the /livekit path prefix.
            var request = httpContext.Request;
            var wsScheme = request.Scheme == "https" ? "wss" : "ws";
            var url = $"{wsScheme}://{request.Host}/livekit";

            return Results.Ok(new { token = metadata.Token, url, expiresAt = metadata.ExpiresAt });
        }).RequireRateLimiting("livekit-token");

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

            tracker.StartOrRefresh(roomName, user.DisplayName, user.Id, user.MatrixUserId);

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

        app.MapGet("/livekit/active-share", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ScreenShareTracker tracker,
            ISessionMappingService sessionMapping) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            var scope = httpContext.Request.Query["scope"].ToString();
            var roomName = httpContext.Request.Query["roomName"].ToString();

            IEnumerable<object> result;

            if (string.Equals(scope, "all", StringComparison.Ordinal))
            {
                result = tracker.GetAllRoomNames()
                    .SelectMany(activeRoomName => tracker.GetActiveShares(activeRoomName).Select(s =>
                    {
                        var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
                        return new { roomName = activeRoomName, s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
                    }))
                    .ToArray();
            }
            else
            {
                if (string.IsNullOrWhiteSpace(roomName))
                    return Results.BadRequest(new { error = "roomName query parameter is required" });

                if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                    return Results.BadRequest(new { error = "invalid roomName format" });

                result = tracker.GetActiveShares(roomName).Select(s =>
                {
                    var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
                    return new { roomName, s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
                }).ToArray();
            }

            return Results.Ok(new { shares = result });
        }).RequireRateLimiting("livekit-active-share");

        return app;
    }
}
