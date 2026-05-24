namespace Brmble.Server.Messages;

public static class MessageDeletionEndpoints
{
    public static IEndpointRouteBuilder MapMessageDeletionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/messages/redact", async (
            HttpContext context,
            DeleteMessageRequest request,
            MessageDeletionService service,
            CancellationToken cancellationToken) =>
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                return Results.Unauthorized();
            }

            var accessToken = authorization["Bearer ".Length..].Trim();
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                return Results.Unauthorized();
            }

            var result = await service.DeleteAsync(accessToken, request, cancellationToken);
            if (result.Success)
            {
                return Results.Ok(result.Response);
            }

            return result.StatusCode switch
            {
                StatusCodes.Status401Unauthorized => Results.Unauthorized(),
                StatusCodes.Status404NotFound => Results.NotFound(new { errorCode = result.ErrorCode }),
                StatusCodes.Status409Conflict => Results.Conflict(new { errorCode = result.ErrorCode }),
                StatusCodes.Status403Forbidden => Results.Json(new { errorCode = result.ErrorCode }, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.BadRequest(new { errorCode = result.ErrorCode ?? "delete_failed" })
            };
        });

        return app;
    }
}
