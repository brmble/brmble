using System.Net.WebSockets;

namespace Brmble.Server.Events;

public interface IBrmbleEventBus
{
    void AddClient(WebSocket ws, long userId);
    void RemoveClient(WebSocket ws);
    Task BroadcastAsync(object message);
    Task BroadcastToChannelAsync(int channelId, object message);
}
