using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, long> _clients = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ISessionMappingService _sessionMapping;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public BrmbleEventBus(
        ILogger<BrmbleEventBus> logger,
        IChannelMembershipService channelMembership,
        ISessionMappingService sessionMapping)
    {
        _logger = logger;
        _channelMembership = channelMembership;
        _sessionMapping = sessionMapping;
    }

    public void AddClient(WebSocket ws, long userId) => _clients[ws] = userId;

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

    public async Task BroadcastToChannelAsync(int channelId, object message)
    {
        var sessions = _channelMembership.GetSessionsInChannel(channelId);
        var userIds = new HashSet<long>();
        var snapshot = _sessionMapping.GetSnapshot();
        foreach (var sessionId in sessions)
        {
            if (snapshot.TryGetValue(sessionId, out var mapping))
                userIds.Add(mapping.UserId);
        }

        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Where(kvp => userIds.Contains(kvp.Value)).Select(async kvp =>
        {
            var ws = kvp.Key;
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
