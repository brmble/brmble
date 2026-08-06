using System.Collections.Concurrent;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.DM;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

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
    private readonly IMatrixAppService _matrix;
    private readonly ChannelRepository _channels;
    private readonly DmRoomRepository _directMessages;
    private readonly IAclAuthorizationService _authorization;
    private readonly TimeProvider _timeProvider;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _eventLocks = new();

    public MessageDeletionService(
        IMatrixAppService matrix,
        ChannelRepository channels,
        DmRoomRepository directMessages,
        IAclAuthorizationService authorization,
        TimeProvider timeProvider)
    {
        _matrix = matrix;
        _channels = channels;
        _directMessages = directMessages;
        _authorization = authorization;
        _timeProvider = timeProvider;
    }

    public async Task<MessageDeletionResult> DeleteAsync(
        User requester,
        string roomId,
        string eventId,
        CancellationToken cancellationToken)
    {
        if (!await IsRequesterConversationAsync(requester.Id, roomId))
        {
            return new(MessageDeletionOutcome.Forbidden);
        }

        var lockKey = $"{roomId}\n{eventId}";
        var gate = _eventLocks.GetOrAdd(lockKey, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);

        try
        {
            var eventJson = await _matrix.GetRoomEvent(roomId, eventId);
            MatrixMessageMetadata message;
            try
            {
                message = MatrixMessageMetadata.Parse(eventJson);
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
                requester.MatrixUserId);
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

    private async Task<bool> IsRequesterConversationAsync(
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
            return true;
        }

        var dmRooms = await _directMessages.GetAllForUserAsync(requesterId);
        return dmRooms.Any(mapping =>
            string.Equals(
                mapping.MatrixRoomId,
                roomId,
                StringComparison.Ordinal));
    }
}
