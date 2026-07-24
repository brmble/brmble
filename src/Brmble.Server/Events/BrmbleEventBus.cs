using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Paint;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, long> _clients = new();
    private readonly ConcurrentDictionary<int, PaintChannelDelivery> _paintChannelDeliveries = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ISessionMappingService _sessionMapping;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed class PaintChannelDelivery
    {
        public object Gate { get; } = new();
        public Task Tail { get; set; } = Task.CompletedTask;
    }

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

    public bool HasConnectedClient(long userId) => _clients.Values.Any(id => id == userId);

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
                RemoveClientAndAbort(ws);
            }
        });

        await Task.WhenAll(tasks);
    }

    public async Task BroadcastToChannelAsync(int channelId, object message)
    {
        var eventType = message.GetType().GetProperty("type")?.GetValue(message) as string;
        if (eventType is not null && eventType != PaintEventNames.PreviewUpdated && PaintEventNames.BroadcastEvents.Contains(eventType))
        {
            await BroadcastPaintPermanentToChannelAsync(channelId, message);
            return;
        }

        await BroadcastToChannelUnorderedAsync(channelId, message);
    }

    private async Task BroadcastToChannelUnorderedAsync(int channelId, object message)
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
                RemoveClientAndAbort(ws);
            }
        });

        await Task.WhenAll(tasks);
    }

    /// <summary>
    /// Paint mutations change durable canvas state, so clients must observe them in
    /// channel order. A slow socket is removed by the normal send timeout rather
    /// than allowing a later mutation to overtake a queued one.
    /// </summary>
    private Task BroadcastPaintPermanentToChannelAsync(int channelId, object message)
    {
        var delivery = _paintChannelDeliveries.GetOrAdd(channelId, _ => new PaintChannelDelivery());
        lock (delivery.Gate)
        {
            delivery.Tail = delivery.Tail
                .ContinueWith(_ => BroadcastToChannelUnorderedAsync(channelId, message), CancellationToken.None,
                    TaskContinuationOptions.None, TaskScheduler.Default)
                .Unwrap();
            return delivery.Tail;
        }
    }

    public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync()
    {
        IReadOnlySet<long> ids = _clients.Values.ToHashSet();
        return Task.FromResult(ids);
    }

    public async Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
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
                RemoveClientAndAbort(ws);
            }
        });

        await Task.WhenAll(tasks);
    }

    private void RemoveClientAndAbort(WebSocket ws)
    {
        RemoveClient(ws);
        try { ws.Abort(); }
        catch (Exception ex) { _logger.LogDebug(ex, "Failed to abort WebSocket client"); }
    }
}
