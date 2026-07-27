using Brmble.Server.Events;

namespace Brmble.Server.Paint;

public interface IPaintEventPublisher
{
    Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message);

    /// <summary>
    /// Publishes a preview, which is fully superseded by the next preview from the same author
    /// in the same session. A preview still queued for a client is replaced rather than both
    /// being delivered, so a painter cannot flood a client that has fallen behind.
    /// </summary>
    Task PublishPreviewToUsersAsync(IReadOnlySet<long> userIds, Guid sessionId, long authorUserId, object message);

    Task PublishToChannelAsync(int channelId, object message);
}

public sealed class BrmblePaintEventPublisher(IBrmbleEventBus eventBus) : IPaintEventPublisher
{
    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => eventBus.BroadcastToUsersAsync(userIds, message);

    public Task PublishPreviewToUsersAsync(IReadOnlySet<long> userIds, Guid sessionId, long authorUserId, object message) =>
        eventBus.BroadcastToUsersAsync(
            userIds,
            message,
            new EventDeliveryOptions { CoalesceKey = $"paint.preview:{sessionId}:{authorUserId}" });

    public Task PublishToChannelAsync(int channelId, object message) => eventBus.BroadcastToChannelAsync(channelId, message);
}
