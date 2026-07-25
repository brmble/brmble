using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, ClientState> _clients = new();
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

    public void AddClient(WebSocket ws, long userId) => _clients[ws] = new(userId);

    public void RemoveClient(WebSocket ws) => _clients.TryRemove(ws, out _);

    public bool HasConnectedClient(long userId) => _clients.Values.Any(client => client.UserId == userId);

    public async Task BroadcastAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Select(async entry =>
        {
            var ws = entry.Key;
            try
            {
                await SendAsync(ws, entry.Value, bytes);
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

        var tasks = _clients.Where(kvp => userIds.Contains(kvp.Value.UserId)).Select(async kvp =>
        {
            var ws = kvp.Key;
            try
            {
                await SendAsync(ws, kvp.Value, bytes);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                RemoveClient(ws);
            }
        });

        await Task.WhenAll(tasks);
    }

    public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync()
    {
        IReadOnlySet<long> ids = _clients.Values.Select(client => client.UserId).ToHashSet();
        return Task.FromResult(ids);
    }

    public async Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Where(kvp => userIds.Contains(kvp.Value.UserId)).Select(async kvp =>
        {
            var ws = kvp.Key;
            try
            {
                await SendAsync(ws, kvp.Value, bytes);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                RemoveClient(ws);
            }
        });

        await Task.WhenAll(tasks);
    }

    private async Task SendAsync(WebSocket socket, ClientState client, ArraySegment<byte> bytes)
    {
        await client.SendGate.WaitAsync();
        try
        {
            if (socket.State != WebSocketState.Open)
            {
                RemoveClient(socket);
                return;
            }
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cts.Token);
        }
        finally
        {
            client.SendGate.Release();
        }
    }

    private sealed record ClientState(long UserId)
    {
        public SemaphoreSlim SendGate { get; } = new(1, 1);
    }
}
