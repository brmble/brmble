using System.Text.Json.Serialization;

namespace Brmble.Server.Paint;

[JsonConverter(typeof(PaintToolJsonConverter))]
public enum PaintTool
{
    Pen,
    Eraser,
}

[JsonConverter(typeof(PaintStrokeWidthJsonConverter))]
public enum PaintStrokeWidth
{
    Thin = 3,
    Medium = 6,
    Wide = 12,
}

[JsonConverter(typeof(PaintSessionStatusJsonConverter))]
public enum PaintSessionStatus
{
    PendingSource,
    Active,
    Ended,
    Expired,
    Unavailable,
}

public sealed record PaintPoint(double X, double Y, double? Pressure);

public sealed record PaintSource(
    string MimeType,
    int Width,
    int Height,
    long SizeBytes);

public sealed record PaintParticipant(
    long UserId,
    int MumbleSessionId,
    string MatrixUserId);

public sealed record PaintStroke(
    Guid Id,
    Guid CorrelationId,
    long AuthorUserId,
    string AuthorMatrixUserId,
    long Sequence,
    long Generation,
    PaintTool Tool,
    string? Color,
    PaintStrokeWidth Width,
    IReadOnlyList<PaintPoint> Points,
    bool Active);

public sealed record PaintStrokeInput(
    Guid CorrelationId,
    long Generation,
    PaintTool Tool,
    string? Color,
    PaintStrokeWidth Width,
    IReadOnlyList<PaintPoint> Points);

public sealed record PaintSessionSnapshot(
    Guid SessionId,
    int ChannelId,
    long HostUserId,
    long CurrentUserId,
    bool IsHost,
    PaintSessionStatus Status,
    long Generation,
    long Revision,
    DateTimeOffset ExpiresAt,
    PaintSource? Source,
    IReadOnlyList<PaintParticipant> Participants,
    IReadOnlyList<PaintStroke> Strokes);

public sealed record PaintSessionSummary(
    Guid SessionId,
    int ChannelId,
    long HostUserId,
    PaintSessionStatus Status,
    bool CanJoin,
    bool IsParticipant);

public static class PaintEventNames
{
    public const string SourceAttached = "paint.sourceAttached";
    public const string Invited = "paint.invited";
    public const string ParticipantJoined = "paint.participantJoined";
    public const string ParticipantLeft = "paint.participantLeft";
    public const string PreviewUpdated = "paint.previewUpdated";
    public const string StrokeCommitted = "paint.strokeCommitted";
    public const string StrokeUndone = "paint.strokeUndone";
    public const string CanvasCleared = "paint.canvasCleared";
    public const string SessionEnded = "paint.sessionEnded";
    public const string SessionExpired = "paint.sessionExpired";
    public const string SessionUnavailable = "paint.sessionUnavailable";

    public static readonly IReadOnlyList<string> BroadcastEvents =
    [
        SourceAttached,
        Invited,
        ParticipantJoined,
        ParticipantLeft,
        PreviewUpdated,
        StrokeCommitted,
        StrokeUndone,
        CanvasCleared,
        SessionEnded,
        SessionExpired,
        SessionUnavailable,
    ];
}
