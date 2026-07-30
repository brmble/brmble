namespace Brmble.Server.Companions;

using System.Collections.Concurrent;
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

public static class CustomCompanionEndpoints
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> DeletionLocks = new();

    public static IEndpointRouteBuilder MapCustomCompanionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/companions", async (
            CustomCompanionCreateRequest request,
            HttpContext httpContext,
            CustomCompanionUploadService uploadService,
            CancellationToken cancellationToken) =>
                await uploadService.CreateAsync(httpContext, request, cancellationToken))
            .RequireRateLimiting("custom-companion-upload");

        app.MapDelete("/companions/{eventId}", async (
            string eventId,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepository,
            IAclAuthorizationService aclAuthorization,
            CustomCompanionRepository repository,
            IMatrixAppService matrixAppService,
            ISessionMappingService sessionMapping,
            IChannelMembershipService channelMembership,
            IBrmbleEventBus eventBus,
            ILogger<CustomCompanionGalleryService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash)) return Results.Unauthorized();

            var user = await userRepository.GetByCertHash(certHash);
            if (user is null) return Results.Unauthorized();
            if (!await aclAuthorization.CanModerateServerAsync(user.Id))
                return Results.StatusCode(StatusCodes.Status403Forbidden);

            var deletionLock = DeletionLocks.GetOrAdd(eventId, _ => new SemaphoreSlim(1, 1));
            await deletionLock.WaitAsync(httpContext.RequestAborted);
            try
            {
                var record = await repository.GetActiveByEventIdAsync(eventId);
                if (record is null) return Results.NoContent();

                try
                {
                    await matrixAppService.RedactRoomEvent(record.RoomId, record.EventId,
                        "Removed by a Brmble moderator");
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to redact custom companion {EventId}", eventId);
                    return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
                }

                if (!await repository.MarkDeletedAsync(record.EventId, user.Id, DateTimeOffset.UtcNow))
                    return Results.NoContent();

                var affectedUserIds = await repository.ResetSelectionsAsync(record.EventId);
                foreach (var affectedUserId in affectedUserIds)
                {
                    if (!sessionMapping.TryGetMappingByUserId(affectedUserId, out var sessionId, out var mapping)
                        || mapping is null)
                    {
                        continue;
                    }

                    sessionMapping.TryUpdateCompanionId(sessionId, "floppy");
                    if (channelMembership.TryGetChannel(sessionId, out var channelId))
                    {
                        await eventBus.BroadcastToChannelAsync(channelId, new
                        {
                            type = "companionChanged",
                            sessionId,
                            matrixUserId = mapping.MatrixUserId,
                            companionId = "floppy",
                            customCompanionId = (string?)null
                        });
                    }
                }

                return Results.NoContent();
            }
            finally
            {
                deletionLock.Release();
            }
        });

        return app;
    }
}
