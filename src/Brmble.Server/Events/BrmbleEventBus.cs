using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, long> _clients = new();
    private readonly ConcurrentDictionary<WebSocket, SocketDelivery> _deliveries = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ISessionMappingService _sessionMapping;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed record QueuedMessage(ArraySegment<byte> Bytes, TaskCompletionSource Completion);

    /// <summary>
    /// Per-socket send queue. <see cref="WebSocket.SendAsync"/> permits only one
    /// outstanding call per socket, so every send is funnelled through a single
    /// drain loop guarded by <see cref="Gate"/>.
    /// </summary>
    private sealed class SocketDelivery
    {
        public object Gate { get; } = new();
        public Queue<QueuedMessage> Queue { get; } = new();
        public bool Draining { get; set; }
        public Exception? Failure { get; set; }
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

    public void RemoveClient(WebSocket ws)
    {
        _clients.TryRemove(ws, out _);
        if (!_deliveries.TryRemove(ws, out var delivery))
            return;

        lock (delivery.Gate)
        {
            FailDeliveryLocked(delivery, new WebSocketException("WebSocket client is no longer connected."));
        }
    }

    /// <summary>
    /// Releases everything still queued for a socket. Callers awaiting those sends are
    /// faulted rather than left waiting on a socket that will never drain. The send
    /// already in flight is not tracked here and completes on its own.
    /// </summary>
    private static void FailDeliveryLocked(SocketDelivery delivery, Exception failure)
    {
        delivery.Failure ??= failure;
        while (delivery.Queue.Count > 0)
            delivery.Queue.Dequeue().Completion.TrySetException(delivery.Failure);
        delivery.Draining = false;
    }

    /// <summary>
    /// Registers a client, optionally queuing an initial payload as part of the same step.
    /// The payload is enqueued before the socket is published to <see cref="_clients"/>, so
    /// any broadcast that can observe the client is necessarily queued behind it. Registering
    /// and sending separately would let a broadcast overtake the payload it amends, which is
    /// why this is the only way to add a client. Returns a task that completes once the
    /// initial payload has been written, or a completed task when there is none.
    /// </summary>
    public Task AddClientAsync(WebSocket ws, long userId, Func<object>? initialMessage = null)
    {
        var delivery = new SocketDelivery();
        _deliveries[ws] = delivery;

        Task initial = Task.CompletedTask;
        if (initialMessage is not null)
        {
            try
            {
                var json = JsonSerializer.Serialize(initialMessage(), JsonOptions);
                var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
                var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

                lock (delivery.Gate)
                {
                    delivery.Queue.Enqueue(new QueuedMessage(bytes, completion));
                    delivery.Draining = true;
                }

                initial = completion.Task;
            }
            catch
            {
                // The client was never published to _clients, so RemoveClient will never run
                // for it. Drop the delivery here or it leaks for the lifetime of the process.
                _deliveries.TryRemove(ws, out _);
                throw;
            }
        }

        _clients[ws] = userId;

        if (initialMessage is not null)
            _ = DrainSocketAsync(ws, delivery);

        return initial;
    }

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
                    await QueueSendAsync(ws, bytes);
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
                    await QueueSendAsync(ws, bytes);
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
                    await QueueSendAsync(ws, bytes);
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

    /// <summary>
    /// Enqueues a payload for a single socket. The returned task completes once the
    /// payload has actually been written to the socket, preserving the back-pressure
    /// the callers relied on when they awaited <see cref="WebSocket.SendAsync"/> directly.
    /// </summary>
    private Task QueueSendAsync(WebSocket ws, ArraySegment<byte> bytes)
    {
        if (!_deliveries.TryGetValue(ws, out var delivery))
            return Task.FromException(new WebSocketException("WebSocket client is no longer connected."));

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        bool startDrain;
        lock (delivery.Gate)
        {
            if (delivery.Failure is not null)
                return Task.FromException(delivery.Failure);

            delivery.Queue.Enqueue(new QueuedMessage(bytes, completion));
            startDrain = !delivery.Draining;
            if (startDrain)
                delivery.Draining = true;
        }

        // Started outside the gate so the first send does not run under the lock.
        if (startDrain)
            _ = DrainSocketAsync(ws, delivery);

        return completion.Task;
    }

    private static async Task DrainSocketAsync(WebSocket ws, SocketDelivery delivery)
    {
        while (true)
        {
            QueuedMessage message;
            lock (delivery.Gate)
            {
                if (delivery.Failure is not null)
                    return;

                if (delivery.Queue.Count == 0)
                {
                    delivery.Draining = false;
                    return;
                }

                message = delivery.Queue.Dequeue();
            }

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await ws.SendAsync(message.Bytes, WebSocketMessageType.Text, true, cts.Token);
                message.Completion.TrySetResult();
            }
            catch (Exception ex)
            {
                message.Completion.TrySetException(ex);
            }
        }
    }
}
