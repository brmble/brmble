namespace Brmble.Server.Messages;

public sealed class MessageDeletionPolicy
{
    private static readonly TimeSpan RegularUserDeleteWindow = TimeSpan.FromHours(24);

    private static readonly HashSet<string> DeletableEventTypes = new(StringComparer.Ordinal)
    {
        "m.room.message",
        "m.sticker"
    };

    public MessageDeletionDecision Decide(
        MatrixTimelineEventInfo targetEvent,
        string requesterMatrixUserId,
        bool requesterIsAdmin,
        DateTimeOffset now)
    {
        if (targetEvent.IsAlreadyRedacted)
        {
            return Deny("already_deleted");
        }

        if (targetEvent.IsStateEvent)
        {
            return Deny("state_event_not_deletable");
        }

        if (!DeletableEventTypes.Contains(targetEvent.EventType))
        {
            return Deny("unsupported_event_type");
        }

        if (requesterIsAdmin)
        {
            return new MessageDeletionDecision(
                Allowed: true,
                DenialCode: null,
                Reason: MessageDeletionReasons.ModeratorDelete,
                PlaceholderText: MessageDeletionPlaceholders.ModeratorDeleted,
                ActorType: "admin");
        }

        if (!string.Equals(targetEvent.SenderMatrixUserId, requesterMatrixUserId, StringComparison.Ordinal))
        {
            return Deny("not_message_owner");
        }

        if (now - targetEvent.OriginServerTimestamp > RegularUserDeleteWindow)
        {
            return Deny("message_too_old");
        }

        return new MessageDeletionDecision(
            Allowed: true,
            DenialCode: null,
            Reason: MessageDeletionReasons.SelfDelete,
            PlaceholderText: MessageDeletionPlaceholders.SelfDeleted,
            ActorType: "user");
    }

    private static MessageDeletionDecision Deny(string code)
    {
        return new MessageDeletionDecision(
            Allowed: false,
            DenialCode: code,
            Reason: null,
            PlaceholderText: null,
            ActorType: null);
    }
}
