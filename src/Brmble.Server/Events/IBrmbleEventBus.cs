using System.Net.WebSockets;

namespace Brmble.Server.Events;

public interface IBrmbleEventBus
{
    void AddClient(WebSocket ws, long userId);
    void RemoveClient(WebSocket ws);
    bool HasConnectedClient(long userId);
    Task BroadcastAsync(object message);
    Task BroadcastToChannelAsync(int channelId, object message);
    Task<IReadOnlySet<long>> GetConnectedUserIdsAsync();
    Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message);
}
