using System.Net.WebSockets;

namespace Brmble.Server.Events;

public readonly record struct DisconnectSnapshot(long UserId, long Generation);

public interface IBrmbleEventBus
{
    Task AddClientAsync(
        WebSocket ws, long userId, Func<Task<IReadOnlyList<object>>>? initialMessages = null);
    void RemoveClient(WebSocket ws);
    DisconnectSnapshot? RemoveClientAndGetDisconnect(WebSocket ws);
    bool IsCurrentEmptyDisconnect(DisconnectSnapshot snapshot);
    bool HasConnectedClient(long userId);
    Task BroadcastAsync(object message);
    Task SendToClientAsync(WebSocket socket, object message);
    Task BroadcastExceptAsync(WebSocket excluded, object message);
    Task BroadcastToChannelAsync(int channelId, object message);
    Task<IReadOnlySet<long>> GetConnectedUserIdsAsync();
    Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message, EventDeliveryOptions options = default);
}
