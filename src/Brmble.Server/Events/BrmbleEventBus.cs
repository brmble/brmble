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

    private sealed record QueuedMessage(ArraySegment<byte> Bytes, TaskCompletionSource Completion);

    /// <summary>
    /// Per-socket send queue. <see cref="WebSocket.SendAsync"/> permits only one
    /// outstanding call per socket, so every send is funnelled through a single
    /// drain loop guarded by <see cref="Gate"/>.
    /// </summary>
    private sealed class SocketDelivery
    {
        public object Gate { get; } = new();
        public LinkedList<QueuedMessage> Queue { get; } = new();
        public bool Draining { get; set; }

        /// <summary>
        /// Set while a registration is building this socket's initial payloads. The drain is
        /// claimed but not running during that window, so nothing queued behind it can be
        /// delivered until the registration returns.
        /// </summary>
        public bool AwaitingInitialPayloads { get; set; }

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

        delivery.Draining = false;
        delivery.AwaitingInitialPayloads = false;
    }

    /// <summary>
    /// Registers a client, optionally queuing an initial batch of payloads as part of the
    /// same step. The socket is published to <see cref="_clients"/> before the payloads are
    /// built, so a broadcast racing the build queues behind them rather than being dropped
    /// for a client that is not yet visible. The payloads are then placed at the head of the
    /// queue, in order, so they still arrive first. A mutation a payload already reflects may
    /// therefore be delivered twice, which these events tolerate; losing it entirely would
    /// not be. Registering and sending separately would reintroduce both hazards, which is
    /// why this is the only way to add a client.
    /// </summary>
    /// <remarks>
    /// The factory is asynchronous and may broadcast, so that a caller can mutate shared
    /// state and announce it to the other clients from inside the registration window. The
    /// registering socket is already visible at that point, so it misses nothing; use
    /// <see cref="BroadcastExceptAsync"/> to keep it from also receiving an announcement its
    /// own initial payload already carries.
    /// </remarks>
    /// <returns>
    /// A task that completes once every initial payload has been written, or a completed
    /// task when there are none.
    /// </returns>
    public async Task AddClientAsync(
        WebSocket ws, long userId, Func<Task<IReadOnlyList<object>>>? initialMessages = null)
    {
        var delivery = new SocketDelivery();
        if (initialMessages is not null)
        {
            // Claim the drain up front so broadcasts arriving during the build queue
            // without starting to send ahead of the initial payloads.
            delivery.Draining = true;
            delivery.AwaitingInitialPayloads = true;
        }

        _deliveries[ws] = delivery;
        _clients[ws] = userId;

        if (initialMessages is null)
            return;

        List<QueuedMessage> queued;
        try
        {
            queued = (await initialMessages())
                .Select(message => new QueuedMessage(
                    Serialize(message),
                    new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)))
                .ToList();
        }
        catch
        {
            // Nothing was queued ahead of the broadcasts that may have arrived during the
            // build, and the client has no payload to make sense of them. Drop it entirely
            // and fault those sends rather than leaving a half-registered client behind.
            RemoveClient(ws);
            throw;
        }

        lock (delivery.Gate)
        {
            // Broadcasts arriving during the build may have overflowed the queue and
            // dropped this client. Queuing the payloads behind a failed delivery would
            // never drain, leaving the registration awaiting payloads that can no
            // longer be sent, so surface the failure instead.
            if (delivery.Failure is not null)
                throw delivery.Failure;

            // Inserted back to front so the batch ends up at the head in its original order.
            for (var i = queued.Count - 1; i >= 0; i--)
                delivery.Queue.AddFirst(queued[i]);

            delivery.AwaitingInitialPayloads = false;
        }

        // The drain was claimed above, so nothing else is running it yet.
        _ = DrainSocketAsync(ws, delivery);
        await Task.WhenAll(queued.Select(message => message.Completion.Task));
    }

    public bool HasConnectedClient(long userId) => _clients.Values.Any(id => id == userId);

    public Task BroadcastAsync(object message) => BroadcastCoreAsync(null, message);

    /// <summary>
    /// Broadcasts to every client except <paramref name="excluded"/>. Used while a client is
    /// registering so an announcement its initial payload already reflects is not also
    /// delivered as a separate event.
    /// </summary>
    public Task BroadcastExceptAsync(WebSocket excluded, object message) =>
        BroadcastCoreAsync(excluded, message);

    private async Task BroadcastCoreAsync(WebSocket? excluded, object message)
    {
        var bytes = Serialize(message);

        var tasks = _clients.Keys.Where(ws => !ReferenceEquals(ws, excluded)).Select(async ws =>
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

    private static ArraySegment<byte> Serialize(object message) =>
        new(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message, JsonOptions)));

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
    /// A client that has stopped draining is disconnected once its queue is full, rather
    /// than being allowed to accumulate payloads without bound.
    /// </summary>
    /// <remarks>
    /// A socket still building its initial payloads cannot drain until its registration
    /// returns, so a send to it completes on enqueue instead. Registrations announce
    /// themselves to the other clients from inside that window, and two clients connecting
    /// at once would otherwise each wait on a queue only the other could release.
    /// </remarks>
    private Task QueueSendAsync(WebSocket ws, ArraySegment<byte> bytes)
    {
        if (!_deliveries.TryGetValue(ws, out var delivery))
            return Task.FromException(new WebSocketException("WebSocket client is no longer connected."));

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        bool startDrain;
        bool completeOnEnqueue;
        Exception? overflow = null;
        lock (delivery.Gate)
        {
            if (delivery.Failure is not null)
                return Task.FromException(delivery.Failure);

            if (delivery.Queue.Count >= _socketQueueCapacity)
            {
                overflow = new WebSocketException(
                    $"WebSocket delivery queue is full ({_socketQueueCapacity} payloads).");
                FailDeliveryLocked(delivery, overflow);
                startDrain = false;
                completeOnEnqueue = false;
            }
            else
            {
                delivery.Queue.AddLast(new QueuedMessage(bytes, completion));
                completeOnEnqueue = delivery.AwaitingInitialPayloads;
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

        if (completeOnEnqueue)
        {
            // Nothing will await this send, so make sure a later failure is still observed.
            _ = completion.Task.ContinueWith(
                static task => _ = task.Exception,
                CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            return Task.CompletedTask;
        }

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
