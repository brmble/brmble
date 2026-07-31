namespace Brmble.Server.Companions;

using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

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

        app.MapDelete("/companions/{eventId}", async (
            string eventId,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepository,
            IAclAuthorizationService aclAuthorization,
            CustomCompanionEventCoordinator eventCoordinator,
            CustomCompanionRepository repository,
            IMatrixAppService matrixAppService,
            ISessionMappingService sessionMapping,
            IMappingEventPublisher publisher,
            ILogger<CustomCompanionGalleryService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash)) return Results.Unauthorized();

            var user = await userRepository.GetByCertHash(certHash);
            if (user is null) return Results.Unauthorized();
            if (!await aclAuthorization.CanModerateServerAsync(user.Id))
                return Results.StatusCode(StatusCodes.Status403Forbidden);

            var sends = new List<Task>();

            using (await eventCoordinator.AcquireAsync(eventId, httpContext.RequestAborted))
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
                var deletedCompanionId = CustomCompanionId.FromEventId(record.EventId);
                foreach (var affectedUserId in affectedUserIds)
                {
                    if (!sessionMapping.TryGetMappingByUserId(affectedUserId, out var sessionId, out var mapping)
                        || mapping is null)
                    {
                        continue;
                    }

                    // PublishAsync returns as soon as the payload is enqueued, so the
                    // coordinator lock is not held across the fan-out. Awaiting these here
                    // would reintroduce exactly what cd7b48fa removed.
                    //
                    // Broadcast server-wide: a channel lookup failure previously swallowed
                    // the event, and out-of-channel clients were never told at all.
                    sends.Add(publisher.PublishAsync(
                        () => sessionMapping.TryUpdateCompanionIdIfCurrent(
                            sessionId, deletedCompanionId, "floppy"),
                        envelope => new
                        {
                            type = "companionChanged",
                            instanceId = envelope.InstanceId,
                            revision = envelope.Revision,
                            sessionId,
                            matrixUserId = mapping.MatrixUserId,
                            companionId = "floppy",
                            customCompanionId = (string?)null
                        }));
                }
            }

            // Awaited outside the coordinator lock: each announcement is a full-server
            // fan-out and one deletion can affect every user wearing the skin, so holding the
            // lock across that socket I/O would serialise unrelated deletions behind it.
            await Task.WhenAll(sends);

            return Results.NoContent();
        });

        return app;
    }
}
