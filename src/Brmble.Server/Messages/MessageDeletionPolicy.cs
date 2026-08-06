using System.Text.Json;

namespace Brmble.Server.Messages;

public enum MessageDeletionDecision
{
    Allowed,
    Forbidden,
    Expired,
    AlreadyDeleted,
    InvalidEvent,
}

public sealed record MatrixMessageMetadata(
    string EventType,
    string Sender,
    DateTimeOffset OriginServerTimestamp,
    bool IsRedacted,
    string? AuthorMatrixUserId = null)
{
    public static MatrixMessageMetadata Parse(JsonElement eventJson)
    {
        if (!eventJson.TryGetProperty("type", out var typeElement)
            || typeElement.GetString() is not { Length: > 0 } eventType
            || !eventJson.TryGetProperty("sender", out var senderElement)
            || senderElement.GetString() is not { Length: > 0 } sender
            || !eventJson.TryGetProperty("origin_server_ts", out var timestampElement)
            || !timestampElement.TryGetInt64(out var timestampMs))
        {
            throw new JsonException(
                "Matrix event is missing type, sender, or origin_server_ts.");
        }

        var isRedacted =
            eventJson.TryGetProperty("unsigned", out var unsignedElement)
            && unsignedElement.ValueKind == JsonValueKind.Object
            && unsignedElement.TryGetProperty(
                "redacted_because", out var redactedBecause)
            && redactedBecause.ValueKind == JsonValueKind.Object;

        string? authorMatrixUserId = null;
        if (eventJson.TryGetProperty("content", out var contentElement)
            && contentElement.ValueKind == JsonValueKind.Object
            && contentElement.TryGetProperty("com.brmble.author_matrix_user_id", out var authorElement)
            && authorElement.ValueKind == JsonValueKind.String
            && authorElement.GetString() is { Length: > 0 } author)
        {
            authorMatrixUserId = author;
        }

        return new(
            eventType,
            sender,
            DateTimeOffset.FromUnixTimeMilliseconds(timestampMs),
            isRedacted,
            authorMatrixUserId);
    }
}

public static class MessageDeletionPolicy
{
    public static readonly TimeSpan DeletionWindow = TimeSpan.FromHours(24);

    public static MessageDeletionDecision Evaluate(
        MatrixMessageMetadata message,
        string requesterMatrixUserId,
        bool canModerate,
        DateTimeOffset now)
    {
        if (!string.Equals(
                message.EventType,
                "m.room.message",
                StringComparison.Ordinal))
        {
            return MessageDeletionDecision.InvalidEvent;
        }

        if (message.IsRedacted)
        {
            return MessageDeletionDecision.AlreadyDeleted;
        }

        var age = now - message.OriginServerTimestamp;
        if (age < TimeSpan.Zero)
        {
            return MessageDeletionDecision.InvalidEvent;
        }

        if (age >= DeletionWindow)
        {
            return MessageDeletionDecision.Expired;
        }

        if (string.Equals(
                message.AuthorMatrixUserId ?? message.Sender,
                requesterMatrixUserId,
                StringComparison.Ordinal)
            || canModerate)
        {
            return MessageDeletionDecision.Allowed;
        }

        return MessageDeletionDecision.Forbidden;
    }
}
