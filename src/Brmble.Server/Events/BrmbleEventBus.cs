using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Server.Paint;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private const int SocketQueueCapacity = 64;
    private readonly ConcurrentDictionary<WebSocket, long> _clients = new();
    private readonly ConcurrentDictionary<WebSocket, SocketDelivery> _socketDeliveries = new();
    private readonly ConcurrentDictionary<int, PaintChannelDelivery> _paintChannelDeliveries = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ISessionMappingService _sessionMapping;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters =
        {
            new PaintStrokeWidthJsonConverter(),
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase),
        },
    };

    internal static string SerializeForWebSocketForTest(object message) =>
        JsonSerializer.Serialize(message, JsonOptions);

    private sealed class PaintStrokeWidthJsonConverter : JsonConverter<PaintStrokeWidth>
    {
        public override PaintStrokeWidth Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.Number || !reader.TryGetInt32(out var value) || !Enum.IsDefined((PaintStrokeWidth)value))
                throw new JsonException("Paint stroke width must be 3, 6, or 12.");

            return (PaintStrokeWidth)value;
        }

        public override void Write(Utf8JsonWriter writer, PaintStrokeWidth value, JsonSerializerOptions options)
        {
            if (!Enum.IsDefined(value))
                throw new JsonException($"Unsupported paint stroke width: {value}.");

            writer.WriteNumberValue((int)value);
        }
    }

    private sealed class PaintChannelDelivery
    {
        public object Gate { get; } = new();
        public Task Tail { get; set; } = Task.CompletedTask;
    }

    private sealed record QueuedSocketMessage(
        ArraySegment<byte> Bytes,
        bool IsPreview,
        (string SessionId, long AuthorUserId)? PreviewKey,
        TaskCompletionSource Completion);

    private sealed class SocketDelivery
    {
        public object Gate { get; } = new();
        public LinkedList<QueuedSocketMessage> Queue { get; } = [];
        public Dictionary<(string, long), LinkedListNode<QueuedSocketMessage>> Previews { get; } = [];
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

    public void AddClient(WebSocket ws, long userId)
    {
        _clients[ws] = userId;
        _socketDeliveries.TryAdd(ws, new SocketDelivery());
    }

    public void RemoveClient(WebSocket ws)
    {
        _clients.TryRemove(ws, out _);
        _socketDeliveries.TryRemove(ws, out _);
    }

    public bool HasConnectedClient(long userId) => _clients.Values.Any(id => id == userId);

    public async Task BroadcastAsync(object message)
    {
        var json = SerializeForWebSocketForTest(message);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
        var (eventType, previewKey) = GetDeliveryMetadata(message);

        var tasks = _clients.Keys.Select(async ws =>
        {
            try
            {
                if (ws.State == WebSocketState.Open)
                {
                    await QueueSend(ws, bytes, eventType, previewKey);
                }
                else
                {
                    RemoveClient(ws);
                }
            }
            catch (WebSocketException ex) when (ex.Data.Contains("SocketQueueFull"))
            {
                throw;
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

    private Task BroadcastToChannelUnorderedAsync(
        int channelId,
        object message,
        TaskCompletionSource? admissionComplete = null)
    {
        try
        {
            var sessions = _channelMembership.GetSessionsInChannel(channelId);
            var userIds = new HashSet<long>();
            var snapshot = _sessionMapping.GetSnapshot();
            foreach (var sessionId in sessions)
            {
                if (snapshot.TryGetValue(sessionId, out var mapping))
                    userIds.Add(mapping.UserId);
            }

            var json = SerializeForWebSocketForTest(message);
            var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
            var (eventType, previewKey) = GetDeliveryMetadata(message);

            var tasks = _clients.Where(kvp => userIds.Contains(kvp.Value)).Select(async kvp =>
            {
                var ws = kvp.Key;
                try
                {
                    if (ws.State == WebSocketState.Open)
                    {
                        await QueueSend(ws, bytes, eventType, previewKey);
                    }
                    else
                    {
                        RemoveClient(ws);
                    }
                }
                catch (WebSocketException ex) when (ex.Data.Contains("SocketQueueFull"))
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                    RemoveClientAndAbort(ws);
                }
            }).ToArray();

            admissionComplete?.TrySetResult();
            return Task.WhenAll(tasks);
        }
        catch (Exception ex)
        {
            admissionComplete?.TrySetResult();
            return Task.FromException(ex);
        }
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
            var admissionComplete = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Task broadcast;
            if (delivery.Tail.IsCompleted)
            {
                broadcast = BroadcastToChannelUnorderedAsync(channelId, message, admissionComplete);
            }
            else
            {
                broadcast = delivery.Tail
                    .ContinueWith(_ => BroadcastToChannelUnorderedAsync(channelId, message, admissionComplete), CancellationToken.None,
                        TaskContinuationOptions.None, TaskScheduler.Default)
                    .Unwrap();
            }
            delivery.Tail = admissionComplete.Task;
            return broadcast;
        }
    }

    public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync()
    {
        IReadOnlySet<long> ids = _clients.Values.ToHashSet();
        return Task.FromResult(ids);
    }

    public async Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        var json = SerializeForWebSocketForTest(message);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));
        var (eventType, previewKey) = GetDeliveryMetadata(message);

        var tasks = _clients.Where(kvp => userIds.Contains(kvp.Value)).Select(async kvp =>
        {
            var ws = kvp.Key;
            try
            {
                if (ws.State == WebSocketState.Open)
                {
                    await QueueSend(ws, bytes, eventType, previewKey);
                }
                else
                {
                    RemoveClient(ws);
                }
            }
            catch (WebSocketException ex) when (ex.Data.Contains("SocketQueueFull"))
            {
                throw;
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
        var removed = _clients.TryRemove(ws, out _);
        _socketDeliveries.TryRemove(ws, out _);
        if (!removed)
            return;

        try { ws.Abort(); }
        catch (Exception ex) { _logger.LogDebug(ex, "Failed to abort WebSocket client"); }
    }

    private static (string? EventType, (string SessionId, long AuthorUserId)? PreviewKey) GetDeliveryMetadata(object message)
    {
        var type = message.GetType().GetProperty("type")?.GetValue(message) as string;
        if (type != PaintEventNames.PreviewUpdated)
            return (type, null);

        var sessionId = message.GetType().GetProperty("sessionId")?.GetValue(message)?.ToString();
        var authorUserId = message.GetType().GetProperty("authorUserId")?.GetValue(message);
        if (string.IsNullOrEmpty(sessionId) || authorUserId is not long author)
            return (type, null);

        return (type, (sessionId, author));
    }

    private Task QueueSend(
        WebSocket ws,
        ArraySegment<byte> bytes,
        string? eventType,
        (string SessionId, long AuthorUserId)? previewKey)
    {
        if (!_clients.ContainsKey(ws) || !_socketDeliveries.TryGetValue(ws, out var delivery))
            return Task.FromException(new WebSocketException("WebSocket client is no longer connected."));

        lock (delivery.Gate)
        {
            if (delivery.Failure is not null)
                return Task.FromException(delivery.Failure);

            if (eventType == PaintEventNames.PreviewUpdated && previewKey is { } key &&
                delivery.Previews.Remove(key, out var olderPreview))
            {
                delivery.Queue.Remove(olderPreview);
                olderPreview.Value.Completion.TrySetResult();
            }

            if (delivery.Queue.Count == SocketQueueCapacity)
            {
                var oldestPreview = delivery.Queue.First;
                while (oldestPreview is not null && !oldestPreview.Value.IsPreview)
                    oldestPreview = oldestPreview.Next;
                if (oldestPreview is null)
                {
                    FailDeliveryLocked(delivery, new WebSocketException("WebSocket delivery queue is full."));
                    RemoveClientAndAbort(ws);
                    var exception = new WebSocketException("WebSocket delivery queue is full.");
                    exception.Data["SocketQueueFull"] = true;
                    return Task.FromException(exception);
                }

                delivery.Queue.Remove(oldestPreview);
                if (oldestPreview.Value.PreviewKey is { } oldestPreviewKey)
                    delivery.Previews.Remove(oldestPreviewKey);
                oldestPreview.Value.Completion.TrySetResult();
            }

            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var queued = new QueuedSocketMessage(bytes, eventType == PaintEventNames.PreviewUpdated, previewKey, completion);
            var node = delivery.Queue.AddLast(queued);
            if (previewKey is { } preview)
                delivery.Previews[preview] = node;

            if (!delivery.Draining)
            {
                delivery.Draining = true;
                _ = DrainSocketAsync(ws, delivery);
            }

            return completion.Task;
        }
    }

    private static void FailDeliveryLocked(SocketDelivery delivery, Exception failure)
    {
        delivery.Failure ??= failure;
        foreach (var queued in delivery.Queue)
            queued.Completion.TrySetException(delivery.Failure);
        delivery.Queue.Clear();
        delivery.Previews.Clear();
        delivery.Draining = false;
    }

    private async Task DrainSocketAsync(WebSocket ws, SocketDelivery delivery)
    {
        while (true)
        {
            QueuedSocketMessage message;
            lock (delivery.Gate)
            {
                if (delivery.Failure is not null)
                    return;

                if (delivery.Queue.First is not { } first)
                {
                    delivery.Draining = false;
                    return;
                }

                message = first.Value;
                delivery.Queue.RemoveFirst();
                if (message.PreviewKey is { } key)
                    delivery.Previews.Remove(key);
            }

            try
            {
                await SendCoreAsync(ws, message.Bytes);
                message.Completion.TrySetResult();
            }
            catch (Exception ex)
            {
                message.Completion.TrySetException(ex);
                lock (delivery.Gate)
                {
                    FailDeliveryLocked(delivery, ex);
                }
                RemoveClientAndAbort(ws);
                return;
            }
        }
    }

    private static async Task SendCoreAsync(WebSocket ws, ArraySegment<byte> bytes)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, cts.Token);
    }
}
