using System.Buffers;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Games.Continuous;

public static class RealtimeGameEndpoint
{
    private const int MaxPayloadBytes = 65_536;
    private static readonly TimeSpan TerminalSendTimeout = TimeSpan.FromSeconds(2);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static async Task HandleAsync(HttpContext context)
    {
        if (!HttpMethods.IsGet(context.Request.Method) || !context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var tickets = context.RequestServices.GetRequiredService<RealtimeTicketStore>();
        var coordinator = context.RequestServices.GetRequiredService<ContinuousGameCoordinator>();
        var environment = context.RequestServices.GetRequiredService<IHostEnvironment>();
        var options = context.RequestServices.GetRequiredService<IOptions<GamesRealtimeOptions>>().Value;
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Brmble.Server.Games.Continuous.RealtimeGameEndpoint");

        if (!context.Request.Query.TryGetValue("ticket", out var ticketValues)
            || ticketValues.Count != 1 || string.IsNullOrEmpty(ticketValues[0]))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (!environment.IsDevelopment())
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (string.IsNullOrEmpty(origin)
                || !options.RealtimeAllowedOrigins.Contains(origin, StringComparer.Ordinal))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
        }

        if (!tickets.TryConsume(ticketValues[0]!, out var scope))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        if (scope.Role != RealtimeRole.Participant)
        {
            await WriteErrorAsync(context, StatusCodes.Status403Forbidden, "wrongRole");
            return;
        }
        if (!coordinator.TryGetActiveMatch(scope.StableUserId, out var active)
            || active.MatchId != scope.MatchId
            || !string.Equals(active.RunnerKey, "continuous", StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var connectionId = string.IsNullOrEmpty(context.Connection.Id)
            ? Guid.NewGuid().ToString("N")
            : context.Connection.Id;
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var mailbox = new RealtimeSnapshotMailbox();
        var attached = await coordinator.AttachParticipantAsync(
            scope.MatchId, scope.StableUserId, scope.SessionId, connectionId, mailbox);
        if (!attached.Ok)
        {
            await socket.CloseOutputAsync(WebSocketCloseStatus.PolicyViolation, attached.Error, context.RequestAborted);
            return;
        }

        logger.LogInformation("Realtime connection {ConnectionId} attached to match {MatchId} as {Role}.",
            connectionId, scope.MatchId, scope.Role);
        var detached = 0;
        using var loops = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        try
        {
            var receive = ReceiveLoopAsync(socket, coordinator, mailbox, scope, connectionId, loops.Token);
            var send = SendLoopAsync(socket, mailbox, loops.Token);
            var completed = await Task.WhenAny(receive, send);
            var outcome = await completed;
            loops.Cancel();
            await ObserveAsync(receive);
            await ObserveAsync(send);

            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                var status = outcome == LoopOutcome.InvalidPayload
                    ? WebSocketCloseStatus.InvalidPayloadData
                    : outcome == LoopOutcome.Terminal
                        ? WebSocketCloseStatus.NormalClosure
                        : WebSocketCloseStatus.EndpointUnavailable;
                var description = outcome == LoopOutcome.Overloaded ? "overloaded" : null;
                await socket.CloseOutputAsync(status, description, CancellationToken.None);
            }
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (WebSocketException) { }
        finally
        {
            loops.Cancel();
            if (Interlocked.Exchange(ref detached, 1) == 0)
                await coordinator.DetachAsync(connectionId);
            logger.LogInformation("Realtime connection {ConnectionId} detached from match {MatchId} as {Role}.",
                connectionId, scope.MatchId, scope.Role);
        }
    }

    private static async Task<LoopOutcome> ReceiveLoopAsync(WebSocket socket,
        ContinuousGameCoordinator coordinator, RealtimeSnapshotMailbox mailbox,
        TicketScope scope, string connectionId, CancellationToken cancellationToken)
    {
        var rented = ArrayPool<byte>.Shared.Rent(MaxPayloadBytes);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var length = 0;
                ValueWebSocketReceiveResult result;
                do
                {
                    if (length == MaxPayloadBytes)
                        return LoopOutcome.InvalidPayload;
                    result = await socket.ReceiveAsync(
                        rented.AsMemory(length, MaxPayloadBytes - length), cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close)
                        return LoopOutcome.PeerClosed;
                    if (result.MessageType != WebSocketMessageType.Text)
                        return LoopOutcome.InvalidPayload;
                    length += result.Count;
                } while (!result.EndOfMessage);

                if (!HandlePayload(rented.AsSpan(0, length), coordinator, mailbox, scope, connectionId))
                    return LoopOutcome.InvalidPayload;
            }
            return LoopOutcome.Cancelled;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return LoopOutcome.Cancelled;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    private static bool HandlePayload(ReadOnlySpan<byte> utf8, ContinuousGameCoordinator coordinator,
        RealtimeSnapshotMailbox mailbox, TicketScope scope, string connectionId)
    {
        try
        {
            using var document = JsonDocument.Parse(utf8.ToArray());
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !TryString(root, "type", out var type)
                || !TryInt64(root, "protocolVersion", out var version) || version != 1
                || !TryInt64(root, "matchId", out var matchId) || matchId != scope.MatchId)
                return false;

            if (type == "attachAck")
            {
                if (root.EnumerateObject().Count() != 4
                    || !TryInt64(root, "snapshotSequence", out var snapshotSequence)) return false;
                coordinator.AcknowledgeAttach(connectionId, snapshotSequence);
                return true;
            }
            if (type is not ("input" or "heartbeat")) return false;
            var heartbeat = type == "heartbeat";
            if (root.EnumerateObject().Count() != (heartbeat ? 10 : 12)
                || !TryInt64(root, "sequence", out var sequence)
                || !TryInt64(root, "predictedTick", out var predictedTick)
                || !TryInt16(root, "moveX", out var moveX) || !TryInt16(root, "moveY", out var moveY)
                || !TryInt16(root, "aimX", out var aimX) || !TryInt16(root, "aimY", out var aimY)
                || !TryBoolean(root, "charging", out var charging)) return false;

            var fireReleased = false;
            var dash = false;
            if (!heartbeat && (!TryBoolean(root, "fireReleased", out fireReleased)
                || !TryBoolean(root, "dash", out dash))) return false;
            var input = new ContinuousInput(sequence, predictedTick, moveX, moveY,
                aimX, aimY, charging, fireReleased, dash);
            var response = coordinator.SubmitInput(
                scope.MatchId, scope.SessionId, scope.Role, input, heartbeat);
            if (!response.Accepted)
            {
                var json = JsonSerializer.Serialize(new
                {
                    type = "inputRejected", protocolVersion = 1, matchId = scope.MatchId,
                    sequence, reason = response.Reason,
                }, JsonOptions);
                mailbox.WriteControl(new RealtimeControl(
                    "inputRejected", null, sequence, json, Coalescible: true));
            }
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static async Task<LoopOutcome> SendLoopAsync(
        WebSocket socket, RealtimeSnapshotMailbox mailbox, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (mailbox.Overloaded) return LoopOutcome.Overloaded;
                RealtimeOutbound outbound;
                using (var poll = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    poll.CancelAfter(TimeSpan.FromMilliseconds(100));
                    try { outbound = await mailbox.ReadNextAsync(poll.Token); }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        continue;
                    }
                }
                var payload = System.Text.Encoding.UTF8.GetBytes(outbound.Json);
                if (outbound.Type == "matchClosed")
                {
                    using var terminal = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    terminal.CancelAfter(TerminalSendTimeout);
                    await socket.SendAsync(payload, WebSocketMessageType.Text, true, terminal.Token);
                    return LoopOutcome.Terminal;
                }
                await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            }
            return LoopOutcome.Cancelled;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return LoopOutcome.Cancelled;
        }
    }

    private static bool TryString(JsonElement root, string name, out string value)
    {
        value = "";
        return root.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            && (value = property.GetString()!) is not null;
    }

    private static bool TryInt64(JsonElement root, string name, out long value)
    {
        value = 0;
        return root.TryGetProperty(name, out var property) && property.TryGetInt64(out value);
    }

    private static bool TryInt16(JsonElement root, string name, out short value)
    {
        value = 0;
        return root.TryGetProperty(name, out var property) && property.TryGetInt16(out value);
    }

    private static bool TryBoolean(JsonElement root, string name, out bool value)
    {
        value = false;
        if (!root.TryGetProperty(name, out var property)
            || property.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = property.GetBoolean();
        return true;
    }

    private static async Task WriteErrorAsync(HttpContext context, int statusCode, string error)
    {
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new { error });
    }

    private static async Task ObserveAsync(Task<LoopOutcome> task)
    {
        try { await task; }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
    }

    private enum LoopOutcome { Cancelled, PeerClosed, InvalidPayload, Overloaded, Terminal }
}
