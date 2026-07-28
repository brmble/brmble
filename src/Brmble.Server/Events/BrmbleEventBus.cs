using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, long> _clients = new();
    private readonly ConcurrentDictionary<WebSocket, SocketDelivery> _deliveries = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ISessionMappingService _sessionMapping;
    private readonly int _socketQueueCapacity;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed record QueuedMessage(
        ArraySegment<byte> Bytes,
        TaskCompletionSource Completion,
        string? CoalesceKey);

    /// <summary>
    /// Per-socket send queue. <see cref="WebSocket.SendAsync"/> permits only one
    /// outstanding call per socket, so every send is funnelled through a single
    /// drain loop guarded by <see cref="Gate"/>.
    /// </summary>
    private sealed class SocketDelivery
    {
        public object Gate { get; } = new();
        public LinkedList<QueuedMessage> Queue { get; } = new();

        /// <summary>
        /// Queued payloads that a later payload may supersede, indexed by coalesce key.
        /// </summary>
        public Dictionary<string, LinkedListNode<QueuedMessage>> Coalescable { get; } = [];

        public bool Draining { get; set; }
        public Exception? Failure { get; set; }
    }

    public BrmbleEventBus(
        ILogger<BrmbleEventBus> logger,
        IChannelMembershipService channelMembership,
        ISessionMappingService sessionMapping,
        IOptions<EventBusSettings> settings)
    {
        _logger = logger;
        _channelMembership = channelMembership;
        _sessionMapping = sessionMapping;
        _socketQueueCapacity = settings.Value.SocketQueueCapacity;
        if (_socketQueueCapacity < 1)
            throw new ArgumentOutOfRangeException(
                nameof(settings),
                _socketQueueCapacity,
                $"{nameof(EventBusSettings.SocketQueueCapacity)} must be at least 1.");
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
    /// Drops any queued payload sharing <paramref name="coalesceKey"/>, completing its caller
    /// as though it had been sent. The newer payload fully supersedes it, which is what the
    /// caller asserts by supplying a key.
    /// </summary>
    private static void SupersedeQueuedLocked(SocketDelivery delivery, string? coalesceKey)
    {
        if (coalesceKey is null || !delivery.Coalescable.Remove(coalesceKey, out var existing))
            return;

        delivery.Queue.Remove(existing);
        existing.Value.Completion.TrySetResult();
    }

    /// <summary>
    /// Frees a slot in a full queue by dropping the oldest coalescable payload, so a client
    /// sending superseded updates is throttled rather than disconnected. Returns false when
    /// nothing may be dropped, leaving the caller to disconnect.
    /// </summary>
    private static bool TryDropOldestCoalescableLocked(SocketDelivery delivery)
    {
        for (var node = delivery.Queue.First; node is not null; node = node.Next)
        {
            if (node.Value.CoalesceKey is not { } key)
                continue;

            delivery.Queue.Remove(node);
            delivery.Coalescable.Remove(key);
            node.Value.Completion.TrySetResult();
            return true;
        }

        return false;
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
        {
            var message = delivery.Queue.First!.Value;
            delivery.Queue.RemoveFirst();
            message.Completion.TrySetException(delivery.Failure);
        }

        delivery.Coalescable.Clear();
        delivery.Draining = false;
    }

    /// <summary>
    /// Registers a client, optionally queuing an initial payload as part of the same step.
    /// The socket is published to <see cref="_clients"/> before the payload is built, so a
    /// broadcast racing the build queues behind the payload rather than being dropped for a
    /// client that is not yet visible. The payload is then placed at the head of the queue so
    /// it still arrives first. A mutation the payload already reflects may therefore be
    /// delivered twice, which these events tolerate; losing it entirely would not be.
    /// Registering and sending separately would reintroduce both hazards, which is why this
    /// is the only way to add a client. Returns a task that completes once the initial
    /// payload has been written, or a completed task when there is none.
    /// </summary>
    public Task AddClientAsync(WebSocket ws, long userId, Func<object>? initialMessage = null)
    {
        var delivery = new SocketDelivery();
        if (initialMessage is not null)
        {
            // Claim the drain up front so broadcasts arriving during the build queue
            // without starting to send ahead of the initial payload.
            delivery.Draining = true;
        }

        _deliveries[ws] = delivery;
        _clients[ws] = userId;

        if (initialMessage is null)
            return Task.CompletedTask;

        try
        {
            var json = JsonSerializer.Serialize(initialMessage(), JsonOptions);
            var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

            lock (delivery.Gate)
            {
                // Broadcasts arriving during the build may have overflowed the queue and
                // dropped this client. Queuing the snapshot behind a failed delivery would
                // never drain, leaving the registration awaiting a payload that can no
                // longer be sent, so surface the failure instead.
                if (delivery.Failure is not null)
                    return Task.FromException(delivery.Failure);

                delivery.Queue.AddFirst(new QueuedMessage(bytes, completion, CoalesceKey: null));
            }

            _ = DrainSocketAsync(ws, delivery);
            return completion.Task;
        }
        catch
        {
            // Nothing was queued ahead of the broadcasts that may have arrived during the
            // build, and the client has no snapshot to make sense of them. Drop it entirely
            // and fault those sends rather than leaving a half-registered client behind.
            RemoveClient(ws);
            throw;
        }
    }

    public bool HasConnectedClient(long userId) => _clients.Values.Any(id => id == userId);

    public Task BroadcastAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Keys
            .Select(ws => SendToClient(ws, bytes, default))
            .ToArray();

        return Task.WhenAll(tasks);
    }

    public Task BroadcastToChannelAsync(int channelId, object message)
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

        var tasks = _clients
            .Where(kvp => userIds.Contains(kvp.Value))
            .Select(kvp => SendToClient(kvp.Key, bytes, default))
            .ToArray();

        return Task.WhenAll(tasks);
    }

    /// <summary>
    /// Enqueues a payload for one client and returns a task tracking its delivery.
    /// </summary>
    /// <remarks>
    /// Deliberately NOT an async method. Ordered broadcasts rely on the payload being
    /// enqueued before this returns, so that admission order matches call order. Making this
    /// async, or awaiting anything before <see cref="QueueSendAsync"/>, would silently break
    /// channel ordering without failing any test that does not race two broadcasts.
    /// </remarks>
    private Task SendToClient(WebSocket ws, ArraySegment<byte> bytes, EventDeliveryOptions options)
    {
        if (ws.State != WebSocketState.Open)
        {
            RemoveClient(ws);
            return Task.CompletedTask;
        }

        return AwaitSendAsync(ws, QueueSendAsync(ws, bytes, options));
    }

    private async Task AwaitSendAsync(WebSocket ws, Task send)
    {
        try
        {
            await send.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
            RemoveClient(ws);
        }
    }

    public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync()
    {
        IReadOnlySet<long> ids = _clients.Values.ToHashSet();
        return Task.FromResult(ids);
    }

    public Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message, EventDeliveryOptions options = default)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients
            .Where(kvp => userIds.Contains(kvp.Value))
            .Select(kvp => SendToClient(kvp.Key, bytes, options))
            .ToArray();

        return Task.WhenAll(tasks);
    }

    /// <summary>
    /// Enqueues a payload for a single socket. The returned task completes once the
    /// payload has actually been written to the socket, preserving the back-pressure
    /// the callers relied on when they awaited <see cref="WebSocket.SendAsync"/> directly.
    /// A client that has stopped draining is disconnected once its queue is full, rather
    /// than being allowed to accumulate payloads without bound.
    /// </summary>
    private Task QueueSendAsync(WebSocket ws, ArraySegment<byte> bytes, EventDeliveryOptions options)
    {
        if (!_deliveries.TryGetValue(ws, out var delivery))
            return Task.FromException(new WebSocketException("WebSocket client is no longer connected."));

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        bool startDrain;
        Exception? overflow = null;
        lock (delivery.Gate)
        {
            if (delivery.Failure is not null)
                return Task.FromException(delivery.Failure);

            SupersedeQueuedLocked(delivery, options.CoalesceKey);

            if (delivery.Queue.Count >= _socketQueueCapacity && !TryDropOldestCoalescableLocked(delivery))
            {
                overflow = new WebSocketException(
                    $"WebSocket delivery queue is full ({_socketQueueCapacity} payloads).");
                FailDeliveryLocked(delivery, overflow);
                startDrain = false;
            }
            else
            {
                var node = delivery.Queue.AddLast(new QueuedMessage(bytes, completion, options.CoalesceKey));
                if (options.CoalesceKey is { } key)
                    delivery.Coalescable[key] = node;

                startDrain = !delivery.Draining;
                if (startDrain)
                    delivery.Draining = true;
            }
        }

        if (overflow is not null)
        {
            // Events have been skipped, so the client can no longer be brought up to date
            // incrementally. Drop the connection and let it reconnect onto a fresh snapshot.
            _clients.TryGetValue(ws, out var userId);
            _logger.LogWarning(
                "WebSocket client for user {UserId} exceeded its delivery queue capacity of {Capacity}; disconnecting to force a resync.",
                userId,
                _socketQueueCapacity);
            RemoveClientAndAbort(ws);
            return Task.FromException(overflow);
        }

        // Started outside the gate so the first send does not run under the lock.
        if (startDrain)
            _ = DrainSocketAsync(ws, delivery);

        return completion.Task;
    }

    /// <summary>
    /// Removes a client and tears down its socket. Aborting also fails whatever send is
    /// currently in flight, which a plain removal cannot reach.
    /// </summary>
    private void RemoveClientAndAbort(WebSocket ws)
    {
        RemoveClient(ws);
        try
        {
            ws.Abort();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to abort WebSocket client");
        }
    }

    /// <summary>
    /// Writes queued payloads one at a time. A failed send means the socket is broken for
    /// everything behind it too, so the whole delivery is failed and the client torn down
    /// here rather than retried payload by payload or left for a caller to notice.
    /// </summary>
    private async Task DrainSocketAsync(WebSocket ws, SocketDelivery delivery)
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

                message = delivery.Queue.First!.Value;
                delivery.Queue.RemoveFirst();
                if (message.CoalesceKey is { } draining)
                    delivery.Coalescable.Remove(draining);
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
                bool alreadyFailed;
                lock (delivery.Gate)
                {
                    // An overflow or an explicit removal may have failed this delivery
                    // already, and whoever did that has torn the socket down. Doing it
                    // again here would abort a socket that is already gone.
                    alreadyFailed = delivery.Failure is not null;
                    FailDeliveryLocked(delivery, ex);
                }

                if (!alreadyFailed)
                {
                    _logger.LogDebug(ex, "WebSocket send failed; disconnecting the client");
                    RemoveClientAndAbort(ws);
                }

                return;
            }
        }
    }
}
