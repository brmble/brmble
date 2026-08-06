using System.Collections.Concurrent;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.DM;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Messages;

public enum MessageDeletionOutcome
{
    Deleted,
    Forbidden,
    Expired,
    AlreadyDeleted,
    InvalidEvent,
}

public sealed record MessageDeletionResult(MessageDeletionOutcome Outcome);

public sealed class MessageDeletionService
{
    private enum ConversationKind
    {
        Unknown,
        Channel,
        DirectMessage,
    }

    private readonly IMatrixAppService _matrix;
    private readonly ChannelRepository _channels;
    private readonly DmRoomRepository _directMessages;
    private readonly IAclAuthorizationService _authorization;
    private readonly TimeProvider _timeProvider;
    private readonly string _trustedBotUserId;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _eventLocks = new();

    public MessageDeletionService(
        IMatrixAppService matrix,
        ChannelRepository channels,
        DmRoomRepository directMessages,
        IAclAuthorizationService authorization,
        TimeProvider timeProvider,
        IOptions<MatrixSettings> matrixSettings)
    {
        _matrix = matrix;
        _channels = channels;
        _directMessages = directMessages;
        _authorization = authorization;
        _timeProvider = timeProvider;
        _trustedBotUserId = $"@brmble:{matrixSettings.Value.ServerDomain}";
    }

    public async Task<MessageDeletionResult> DeleteAsync(
        User requester,
        string roomId,
        string eventId,
        CancellationToken cancellationToken)
    {
        var conversationKind = await GetConversationKindAsync(requester.Id, roomId);
        if (conversationKind == ConversationKind.Unknown)
        {
            return new(MessageDeletionOutcome.Forbidden);
        }

        var redactionActor = conversationKind == ConversationKind.DirectMessage
            ? requester.MatrixUserId
            : null;

        var lockKey = $"{roomId}\n{eventId}";
        var gate = _eventLocks.GetOrAdd(lockKey, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            var eventJson = await _matrix.GetRoomEvent(roomId, eventId, redactionActor);
            MatrixMessageMetadata message;
            try
            {
                message = MatrixMessageMetadata.Parse(eventJson, _trustedBotUserId);
            }
            catch (JsonException)
            {
                return new(MessageDeletionOutcome.InvalidEvent);
            }

            var effectiveAuthor = message.AuthorMatrixUserId ?? message.Sender;
            var isAuthor = string.Equals(
                effectiveAuthor,
                requester.MatrixUserId,
                StringComparison.Ordinal);
            var canModerate = !isAuthor
                && await _authorization.CanModerateServerAsync(requester.Id);

            var decision = MessageDeletionPolicy.Evaluate(
                message with { Sender = effectiveAuthor },
                requester.MatrixUserId,
                canModerate,
                _timeProvider.GetUtcNow());

            if (decision != MessageDeletionDecision.Allowed)
            {
                return new(decision switch
                {
                    MessageDeletionDecision.Forbidden =>
                        MessageDeletionOutcome.Forbidden,
                    MessageDeletionDecision.Expired =>
                        MessageDeletionOutcome.Expired,
                    MessageDeletionDecision.AlreadyDeleted =>
                        MessageDeletionOutcome.AlreadyDeleted,
                    _ => MessageDeletionOutcome.InvalidEvent,
                });
            }

            await _matrix.RedactRoomEvent(
                roomId,
                eventId,
                "Deleted through Brmble",
                redactionActor);
            return new(MessageDeletionOutcome.Deleted);
        }
        finally
        {
            gate.Release();
            if (gate.CurrentCount == 1)
            {
                _eventLocks.TryRemove(
                    new KeyValuePair<string, SemaphoreSlim>(lockKey, gate));
            }
        }
    }

    private async Task<ConversationKind> GetConversationKindAsync(
        long requesterId,
        string roomId)
    {
        var channelRooms = await _channels.GetAllAsync();
        if (channelRooms.Any(mapping =>
                string.Equals(
                    mapping.MatrixRoomId,
                    roomId,
                    StringComparison.Ordinal)))
        {
            return ConversationKind.Channel;
        }

        var dmRooms = await _directMessages.GetAllForUserAsync(requesterId);
        return dmRooms.Any(mapping =>
                string.Equals(
                    mapping.MatrixRoomId,
                    roomId,
                    StringComparison.Ordinal))
            ? ConversationKind.DirectMessage
            : ConversationKind.Unknown;
    }
}
