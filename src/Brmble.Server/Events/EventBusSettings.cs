namespace Brmble.Server.Events;

public class EventBusSettings
{
    /// <summary>
    /// Maximum number of payloads that may be queued for a single WebSocket client before
    /// that client is disconnected. Sends are serialized per socket, so a client that stops
    /// draining would otherwise accumulate payloads without bound.
    /// </summary>
    /// <remarks>
    /// Sized to absorb legitimate bursts such as a mass reconnect or an ACL sweep, while
    /// still bounding per-client memory. Raising it increases the worst-case memory a single
    /// stalled client can hold; lowering it disconnects slow clients sooner.
    /// </remarks>
    public int SocketQueueCapacity { get; init; } = 256;
}
