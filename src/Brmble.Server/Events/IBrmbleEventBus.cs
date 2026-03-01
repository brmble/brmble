using System.Net.WebSockets;

namespace Brmble.Server.Events;

public interface IBrmbleEventBus
{
    void AddClient(WebSocket ws);
    void RemoveClient(WebSocket ws);
    Task BroadcastAsync(object message);
}
