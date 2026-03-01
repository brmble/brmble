using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, byte> _clients = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public BrmbleEventBus(ILogger<BrmbleEventBus> logger)
    {
        _logger = logger;
    }

    public void AddClient(WebSocket ws) => _clients.TryAdd(ws, 0);

    public void RemoveClient(WebSocket ws) => _clients.TryRemove(ws, out _);

    public async Task BroadcastAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Keys.Select(async ws =>
        {
            try
            {
                if (ws.State == WebSocketState.Open)
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, cts.Token);
                }
                else
                {
                    RemoveClient(ws);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                RemoveClient(ws);
            }
        });

        await Task.WhenAll(tasks);
    }
}
