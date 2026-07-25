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

    public void AddPausedClient(WebSocket ws, long userId) => _clients[ws] = new(userId) { Paused = true };

    public async Task CompleteInitializationAsync(
        WebSocket ws, IReadOnlyList<object> initialMessages, CancellationToken cancellationToken)
    {
        if (!_clients.TryGetValue(ws, out var client)) return;
        await client.SendGate.WaitAsync(cancellationToken);
        try
        {
            foreach (var message in initialMessages)
                await SendBytesAsync(ws, Serialize(message), cancellationToken);
            while (true)
            {
                ArraySegment<byte> buffered;
                lock (client.StateGate)
                {
                    if (!client.Buffered.TryDequeue(out buffered))
                    {
                        client.Paused = false;
                        break;
                    }
                }
                await SendBytesAsync(ws, buffered, cancellationToken);
            }
        }
        catch
        {
            RemoveClient(ws);
            throw;
        }
        finally
        {
            client.SendGate.Release();
        }
    }

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

    public async Task BroadcastExceptAsync(WebSocket excluded, object message)
    {
        var bytes = Serialize(message);
        var tasks = _clients.Where(entry => !ReferenceEquals(entry.Key, excluded)).Select(async entry =>
        {
            try
            {
                await SendAsync(entry.Key, entry.Value, bytes);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                RemoveClient(entry.Key);
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
        lock (client.StateGate)
        {
            if (client.Paused)
            {
                client.Buffered.Enqueue(bytes);
                return;
            }
        }
        await client.SendGate.WaitAsync();
        try
        {
            if (socket.State != WebSocketState.Open)
            {
                RemoveClient(socket);
                return;
            }
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await SendBytesAsync(socket, bytes, cts.Token);
        }
        finally
        {
            client.SendGate.Release();
        }
    }

    private sealed record ClientState(long UserId)
    {
        public SemaphoreSlim SendGate { get; } = new(1, 1);
        public object StateGate { get; } = new();
        public Queue<ArraySegment<byte>> Buffered { get; } = [];
        public bool Paused { get; set; }
    }

    private static ArraySegment<byte> Serialize(object message) =>
        new(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message, JsonOptions)));

    private static Task SendBytesAsync(WebSocket socket, ArraySegment<byte> bytes, CancellationToken token) =>
        socket.SendAsync(bytes, WebSocketMessageType.Text, true, token);
}
