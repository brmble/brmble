using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Brmble.Server.Data;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brmble.Server.Paint;

/// <summary>HTTP boundary for the stateful paint session manager.</summary>
public static class PaintEndpoints
{
    private static readonly JsonSerializerOptions PaintJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters =
        {
            new PaintStrokeWidthJsonConverter(),
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase),
        },
    };

    public sealed record CreatePaintSessionDto(int ChannelId, IReadOnlyList<int>? ParticipantSessionIds);
    public sealed record AttachPaintSourceDto(string? SourceEventId);
    public sealed record PaintPointDto(double X, double Y, double? Pressure);
    public sealed record PaintStrokeDto(Guid CorrelationId, long Generation, string? Tool, string? Color, int Width, IReadOnlyList<PaintPointDto>? Points);

    private sealed class PaintStrokeWidthJsonConverter : JsonConverter<PaintStrokeWidth>
    {
        public override PaintStrokeWidth Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.Number || !reader.TryGetInt32(out var value) || !Enum.IsDefined((PaintStrokeWidth)value))
                throw new JsonException("Paint stroke width must be 3, 6, or 12.");

            return (PaintStrokeWidth)value;
        }

        public override void Write(Utf8JsonWriter writer, PaintStrokeWidth value, JsonSerializerOptions options)
        {
            if (!Enum.IsDefined(value))
                throw new JsonException($"Unsupported paint stroke width: {value}.");

            writer.WriteNumberValue((int)value);
        }
    }

    public static IEndpointRouteBuilder MapPaintEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/paint/sessions", async (HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, IPaintPresence presence, PaintSessionManager manager, CancellationToken cancellationToken) =>
            await ExecuteWithBodyAsync<CreatePaintSessionDto>(async (user, dto) =>
            {
                if (!presence.TryGetParticipant(user.UserId, out var host) || host.ChannelId != dto.ChannelId)
                    throw new PaintAuthorizationException("Host must be connected to the requested channel.");
                var result = await manager.CreateAsync(user.UserId, dto.ParticipantSessionIds ?? [], cancellationToken);
                return Results.Ok(result);
            }, context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/source", async (Guid id, HttpContext context,
            ICertificateHashExtractor certificates, UserRepository users, PaintSessionManager manager, CancellationToken cancellationToken) =>
            await ExecuteWithBodyAsync<AttachPaintSourceDto>(async (user, dto) =>
            {
                if (string.IsNullOrWhiteSpace(dto.SourceEventId)) throw new PaintValidationException("sourceEventId is required.");
                return Results.Ok(await manager.AttachSourceAsync(id, user.UserId, dto.SourceEventId, cancellationToken));
            }, context, certificates, users));

        app.MapGet("/paint/sessions/{id:guid}/summary", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager) =>
            await ExecuteAsync(async user => Results.Json(await manager.SummaryAsync(id, user.UserId), PaintJsonOptions), context, certificates, users));

        app.MapGet("/paint/sessions/{id:guid}", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager) =>
            await ExecuteAsync(async user => Results.Json(await manager.SnapshotAsync(id, user.UserId), PaintJsonOptions), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/join", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager, CancellationToken cancellationToken) =>
            await ExecuteAsync(async user => Results.Ok(await manager.JoinAsync(id, user.UserId, cancellationToken)), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/prepare-join", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager, CancellationToken cancellationToken) =>
            await ExecuteAsync(async user => Results.Ok(await manager.PrepareJoinAsync(id, user.UserId, cancellationToken)), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/leave", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager) =>
            await ExecuteAsync(async user => Results.Ok(await manager.LeaveAsync(id, user.UserId)), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/stroke", async (Guid id, HttpContext context,
            ICertificateHashExtractor certificates, UserRepository users, PaintSessionManager manager) =>
            await ExecuteWithBodyAsync<PaintStrokeDto>(async (user, dto) => Results.Created($"/paint/sessions/{id}", await manager.CommitStrokeAsync(id, user.UserId, ToStrokeInput(dto))), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/preview", async (Guid id, HttpContext context,
            ICertificateHashExtractor certificates, UserRepository users, PaintSessionManager manager) =>
            await ExecuteWithBodyAsync<PaintStrokeDto>(async (user, dto) => Results.Accepted($"/paint/sessions/{id}", await manager.PreviewAsync(id, user.UserId, ToStrokeInput(dto))), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/undo", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager) =>
            await ExecuteAsync(async user => Results.Ok(await manager.UndoAsync(id, user.UserId)), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/clear", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager) =>
            await ExecuteAsync(async user => Results.Ok(await manager.ClearAsync(id, user.UserId)), context, certificates, users));

        app.MapPost("/paint/sessions/{id:guid}/end", async (Guid id, HttpContext context, ICertificateHashExtractor certificates,
            UserRepository users, PaintSessionManager manager, CancellationToken cancellationToken) =>
            await ExecuteAsync(async user => Results.Accepted($"/paint/sessions/{id}", await manager.EndAsync(id, user.UserId, cancellationToken)), context, certificates, users));

        return app;
    }

    private static PaintStrokeInput ToStrokeInput(PaintStrokeDto dto)
    {
        if (!Enum.TryParse<PaintTool>(dto.Tool, ignoreCase: true, out var tool) || !Enum.IsDefined(tool))
            throw new PaintValidationException("tool is invalid.");
        if (!Enum.IsDefined((PaintStrokeWidth)dto.Width)) throw new PaintValidationException("width is invalid.");
        if (dto.Points is null) throw new PaintValidationException("points is required.");
        return new PaintStrokeInput(dto.CorrelationId, dto.Generation, tool, dto.Color, (PaintStrokeWidth)dto.Width,
            dto.Points.Select(point => new PaintPoint(point.X, point.Y, point.Pressure)).ToArray());
    }

    private static async Task<IResult> ExecuteAsync(Func<AuthenticatedChannelRequestUser, Task<IResult>> action,
        HttpContext context, ICertificateHashExtractor certificates, UserRepository users)
    {
        var user = await ResolveUserAsync(context, certificates, users);
        if (user is null) return Unauthenticated();
        try { return await action(user); }
        catch (Exception exception) when (exception is PaintNotFoundException or PaintAuthorizationException or PaintConflictException or PaintValidationException)
        {
            return ToError(exception);
        }
    }

    private static async Task<IResult> ExecuteWithBodyAsync<T>(Func<AuthenticatedChannelRequestUser, T, Task<IResult>> action,
        HttpContext context, ICertificateHashExtractor certificates, UserRepository users)
    {
        var user = await ResolveUserAsync(context, certificates, users);
        if (user is null) return Unauthenticated();
        try
        {
            var body = await JsonSerializer.DeserializeAsync<T>(context.Request.Body,
                new JsonSerializerOptions(JsonSerializerDefaults.Web), context.RequestAborted);
            if (body is null) throw new PaintValidationException("Request body is required.");
            return await action(user, body);
        }
        catch (JsonException)
        {
            return ToError(new PaintValidationException("Request body must be valid JSON."));
        }
        catch (Exception exception) when (exception is PaintNotFoundException or PaintAuthorizationException or PaintConflictException or PaintValidationException)
        {
            return ToError(exception);
        }
    }

    private static IResult ToError(Exception exception)
    {
        var (status, code) = exception switch
        {
            PaintNotFoundException => (StatusCodes.Status404NotFound, "SESSION_NOT_FOUND"),
            PaintValidationException => (StatusCodes.Status400BadRequest, "INVALID_REQUEST"),
            PaintAuthorizationException authorization when authorization.Message.Contains("Matrix paint room", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status403Forbidden, "MATRIX_MEMBERSHIP_REQUIRED"),
            PaintAuthorizationException authorization when authorization.Message.Contains("Only the host", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status403Forbidden, "HOST_REQUIRED"),
            PaintAuthorizationException authorization when authorization.Message.Contains("paint channel", StringComparison.OrdinalIgnoreCase)
                || authorization.Message.Contains("not selected", StringComparison.OrdinalIgnoreCase)
                || authorization.Message.Contains("not joined", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status403Forbidden, "PARTICIPANT_REQUIRED"),
            PaintAuthorizationException => (StatusCodes.Status403Forbidden, "PAINT_FORBIDDEN"),
            PaintConflictException conflict when conflict.Message.Contains("stale", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status409Conflict, "STALE_GENERATION"),
            PaintConflictException conflict when conflict.Message.Contains("No active stroke", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status409Conflict, "NO_ACTIVE_STROKE"),
            PaintConflictException conflict when conflict.Message.Contains("active", StringComparison.OrdinalIgnoreCase)
                => (StatusCodes.Status409Conflict, "SESSION_NOT_ACTIVE"),
            PaintConflictException => (StatusCodes.Status409Conflict, "PAINT_CONFLICT"),
            _ => throw new InvalidOperationException("Unexpected paint endpoint error mapping."),
        };
        return Results.Json(new { code, error = exception.Message }, statusCode: status);
    }

    private static IResult Unauthenticated()
        => Results.Json(new { code = "UNAUTHENTICATED", error = "Authentication is required." },
            statusCode: StatusCodes.Status401Unauthorized);

    private static async Task<AuthenticatedChannelRequestUser?> ResolveUserAsync(HttpContext context,
        ICertificateHashExtractor certificates, UserRepository users)
    {
        var hash = certificates.GetCertHash(context);
        if (string.IsNullOrWhiteSpace(hash)) return null;
        var user = await users.GetByCertHash(hash);
        return user is null ? null : new AuthenticatedChannelRequestUser(user.Id, user.DisplayName);
    }
}
