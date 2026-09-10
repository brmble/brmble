using Brmble.Server.Auth;

namespace Brmble.Server.Messages;

public sealed record DeleteMessageRequest(string RoomId, string EventId);

public static class MessageEndpoints
{
    public static IEndpointRouteBuilder MapMessageEndpoints(
        this IEndpointRouteBuilder app)
    {
        app.MapPost("/messages/delete", DeleteMessageAsync);
        return app;
    }

    private static async Task<IResult> DeleteMessageAsync(
        DeleteMessageRequest request,
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository users,
        MessageDeletionService deletionService)
    {
        if (string.IsNullOrWhiteSpace(request.RoomId)
            || string.IsNullOrWhiteSpace(request.EventId))
        {
            return Error(
                StatusCodes.Status400BadRequest,
                "invalid_request",
                "roomId and eventId are required.");
        }

        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrWhiteSpace(certHash))
        {
            return Results.Unauthorized();
        }

        var requester = await users.GetByCertHash(certHash);
        if (requester is null)
        {
            return Results.Unauthorized();
        }

        try
        {
            var result = await deletionService.DeleteAsync(
                requester,
                request.RoomId,
                request.EventId,
                httpContext.RequestAborted);

            return result.Outcome switch
            {
                MessageDeletionOutcome.Deleted =>
                    Results.Ok(new { status = "deleted" }),
                MessageDeletionOutcome.Forbidden =>
                    Error(
                        StatusCodes.Status403Forbidden,
                        "not_authorized",
                        "You do not have permission to delete this message."),
                MessageDeletionOutcome.Expired =>
                    Error(
                        StatusCodes.Status410Gone,
                        "expired",
                        "Messages can only be deleted within 24 hours."),
                MessageDeletionOutcome.AlreadyDeleted =>
                    Error(
                        StatusCodes.Status409Conflict,
                        "already_deleted",
                        "This message has already been deleted."),
                _ =>
                    Error(
                        StatusCodes.Status400BadRequest,
                        "invalid_event",
                        "Only Matrix room messages can be deleted."),
            };
        }
        catch (OperationCanceledException)
            when (httpContext.RequestAborted.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return Error(
                StatusCodes.Status503ServiceUnavailable,
                "matrix_unavailable",
                "Message deletion is temporarily unavailable.");
        }
    }

    private static IResult Error(
        int statusCode,
        string code,
        string error) =>
        Results.Json(new { code, error }, statusCode: statusCode);
}
