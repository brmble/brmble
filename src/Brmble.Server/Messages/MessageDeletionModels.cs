namespace Brmble.Server.Messages;

public static class MessageDeletionReasons
{
    public const string SelfDelete = "brmble:self-delete";
    public const string ModeratorDelete = "brmble:moderator-delete";
}

public static class MessageDeletionPlaceholders
{
    public const string SelfDeleted = "This message was deleted";
    public const string ModeratorDeleted = "This message was deleted by a moderator";
}

public sealed record MatrixTimelineEventInfo(
    string RoomId,
    string EventId,
    string SenderMatrixUserId,
    DateTimeOffset OriginServerTimestamp,
    string EventType,
    bool IsAlreadyRedacted,
    bool IsStateEvent);

public sealed record MessageDeletionDecision(
    bool Allowed,
    string? DenialCode,
    string? Reason,
    string? PlaceholderText,
    string? ActorType);

public sealed record DeleteMessageRequest(
    string RoomId,
    string EventId,
    string? TxnId);

public sealed record DeleteMessageResponse(
    string RoomId,
    string EventId,
    string RedactionEventId,
    string Reason,
    string PlaceholderText,
    string ActorType);
