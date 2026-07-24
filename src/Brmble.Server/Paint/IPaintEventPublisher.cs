using Brmble.Server.Events;

namespace Brmble.Server.Paint;

public interface IPaintEventPublisher
{
    Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message);
    Task PublishToChannelAsync(int channelId, object message);
}

public sealed class BrmblePaintEventPublisher(IBrmbleEventBus eventBus) : IPaintEventPublisher
{
    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => eventBus.BroadcastToUsersAsync(userIds, message);
    public Task PublishToChannelAsync(int channelId, object message) => eventBus.BroadcastToChannelAsync(channelId, message);
}
