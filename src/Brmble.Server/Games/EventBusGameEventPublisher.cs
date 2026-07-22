using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class EventBusGameEventPublisher : IGameEventPublisher
{
    private readonly IBrmbleEventBus _bus;

    public EventBusGameEventPublisher(IBrmbleEventBus bus) => _bus = bus;

    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
        => _bus.BroadcastToUsersAsync(userIds, message);

    public Task PublishToChannelAsync(int channelId, object message)
        => _bus.BroadcastToChannelAsync(channelId, message);
}
