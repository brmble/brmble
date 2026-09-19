using System.Buffers;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Games.Continuous;

public static class RealtimeGameEndpoint
{
    private const int MaxPayloadBytes = 65_536;
    private static readonly TimeSpan TerminalSendTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan CloseOutputTimeout = TimeSpan.FromSeconds(2);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static async Task HandleAsync(HttpContext context)
    {
        if (!IsSupportedHandshakeMethod(context.Request.Method) || !context.WebSockets.IsWebSocketRequest)
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
        var hooks = context.RequestServices.GetService<RealtimeGameEndpointHooks>();
        if (hooks?.BeforeRevalidateAsync is not null)
            await hooks.BeforeRevalidateAsync(scope);
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

        var connectionId = CreateConnectionId();
        // Development-only artificial latency; the null object outside Development
        // returns the accepted socket untouched.
        var transportDelay = context.RequestServices.GetService<DevRealtimeTransportDelay>()
            ?? DevRealtimeTransportDelay.None;
        using var socket = transportDelay.Wrap(await context.WebSockets.AcceptWebSocketAsync());
        var mailbox = new RealtimeSnapshotMailbox();
        var attached = await coordinator.AttachParticipantAsync(
            scope.MatchId, scope.StableUserId, scope.SessionId, connectionId, mailbox);
        if (!attached.Ok)
        {
            await CloseOutputBoundedAsync(
                socket, WebSocketCloseStatus.PolicyViolation, attached.Error, CloseOutputTimeout);
            return;
        }
        hooks?.AfterAttach?.Invoke(mailbox);

        logger.LogInformation("Realtime connection {ConnectionId} attached to match {MatchId} as {Role}.",
            connectionId, scope.MatchId, scope.Role);
        var detached = 0;
        LoopOutcome? outcome = null;
        using var loops = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        try
        {
            var receive = ReceiveLoopAsync(socket, coordinator, mailbox, scope, connectionId, logger, loops.Token);
            outcome = await RunWriterAsync(socket, mailbox, receive, loops.Token);
            loops.Cancel();
            await ObserveAsync(receive);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            outcome = LoopOutcome.Cancelled;
        }
        catch (WebSocketException ex)
        {
            logger.LogWarning(ex,
                "Realtime connection {ConnectionId} for match {MatchId}, session {SessionId} failed.",
                connectionId, scope.MatchId, scope.SessionId);
        }
        finally
        {
            loops.Cancel();
            if (Interlocked.Exchange(ref detached, 1) == 0)
                await coordinator.DetachAsync(connectionId);
            logger.LogInformation(
                "Realtime connection {ConnectionId} detached from match {MatchId}, session {SessionId} as {Role} with outcome {Outcome}, close status {CloseStatus}, description {CloseDescription}.",
                connectionId, scope.MatchId, scope.SessionId, scope.Role, outcome?.ToString() ?? "exception",
                socket.CloseStatus?.ToString() ?? "none", socket.CloseStatusDescription ?? "none");
        }
    }

    internal static bool IsSupportedHandshakeMethod(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsConnect(method);

    internal static string CreateConnectionId() =>
        Guid.NewGuid().ToString("N");

    private static async Task<LoopOutcome> ReceiveLoopAsync(WebSocket socket,
        ContinuousGameCoordinator coordinator, RealtimeSnapshotMailbox mailbox,
        TicketScope scope, string connectionId, ILogger logger, CancellationToken cancellationToken)
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

                if (!HandlePayload(rented.AsMemory(0, length), coordinator, mailbox, scope, connectionId, logger))
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

    private static bool HandlePayload(ReadOnlyMemory<byte> utf8, ContinuousGameCoordinator coordinator,
        RealtimeSnapshotMailbox mailbox, TicketScope scope, string connectionId, ILogger logger)
    {
        try
        {
            using var document = JsonDocument.Parse(utf8);
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
                logger.LogInformation(
                    "Realtime input rejected for match {MatchId}, session {SessionId}, sequence {Sequence}: {Reason}; acknowledged {AcknowledgedInput}.",
                    scope.MatchId, scope.SessionId, sequence, response.Reason, response.AcknowledgedInput);
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

    internal static async Task<LoopOutcome> RunWriterAsync(WebSocket socket,
        RealtimeSnapshotMailbox mailbox, Task<LoopOutcome> receive, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            if (mailbox.Overloaded)
            {
                socket.Abort();
                return LoopOutcome.Overloaded;
            }
            if (mailbox.TerminalAvailableTimestamp != 0
                && mailbox.TryTakeTerminal(out var sealedTerminal))
                return await SendTerminalAndCloseAsync(socket, mailbox, sealedTerminal, cancellationToken);
            if (receive.IsCompleted)
                return await CloseForReceiveOutcomeAsync(socket, await receive);

            using var readCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var read = mailbox.ReadNextAsync(readCancellation.Token).AsTask();
            var transition = WaitForCancellationAsync(mailbox.TerminalOrOverload);
            var ready = await Task.WhenAny(read, receive, transition);
            if (ready == receive)
            {
                readCancellation.Cancel();
                await ObserveIoAsync(read);
                return await CloseForReceiveOutcomeAsync(socket, await receive);
            }
            if (ready == transition)
            {
                if (mailbox.Overloaded)
                {
                    readCancellation.Cancel();
                    await ObserveIoAsync(read);
                    socket.Abort();
                    return LoopOutcome.Overloaded;
                }
                readCancellation.Cancel();
                RealtimeOutbound? consumed = null;
                try { consumed = await read; }
                catch (OperationCanceledException) { }
                if (!mailbox.TryTakeTerminal(out var terminal))
                {
                    if (consumed?.Type != "matchClosed")
                    {
                        socket.Abort();
                        return LoopOutcome.TerminalTimedOut;
                    }
                    terminal = consumed;
                }
                return await SendTerminalAndCloseAsync(socket, mailbox, terminal, cancellationToken);
            }

            var outbound = await read;
            if (mailbox.TerminalAvailableTimestamp != 0 && outbound.Type != "matchClosed")
                continue;
            if (outbound.Type == "matchClosed")
                return await SendTerminalAndCloseAsync(socket, mailbox, outbound, cancellationToken);

            var payload = System.Text.Encoding.UTF8.GetBytes(outbound.Json);
            var send = socket.SendAsync(
                new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, CancellationToken.None);
            var sendOutcome = await WaitForOrdinarySendAsync(
                socket, mailbox, send, receive, cancellationToken);
            if (sendOutcome is not null) return sendOutcome.Value;
        }
        socket.Abort();
        return LoopOutcome.Cancelled;
    }

    private static async Task<LoopOutcome?> WaitForOrdinarySendAsync(WebSocket socket,
        RealtimeSnapshotMailbox mailbox, Task send, Task<LoopOutcome> receive,
        CancellationToken cancellationToken)
    {
        var transition = WaitForCancellationAsync(mailbox.TerminalOrOverload);
        var stopping = WaitForCancellationAsync(cancellationToken);
        var completed = await Task.WhenAny(send, receive, transition, stopping);
        if (completed == send)
        {
            await send;
            return null;
        }
        if (completed == stopping)
        {
            socket.Abort();
            await ObserveIoAsync(send);
            return LoopOutcome.Cancelled;
        }

        if (completed == transition && mailbox.Overloaded)
        {
            socket.Abort();
            await ObserveIoAsync(send);
            return LoopOutcome.Overloaded;
        }

        var outcome = completed == receive ? await receive : (LoopOutcome?)null;
        var timeout = outcome is null
            ? RemainingTerminalTime(mailbox)
            : CloseOutputTimeout;
        if (timeout <= TimeSpan.Zero || await Task.WhenAny(send, Task.Delay(timeout)) != send)
        {
            socket.Abort();
            await ObserveIoAsync(send);
            return outcome ?? LoopOutcome.TerminalTimedOut;
        }
        await send;
        if (outcome is not null)
            return await CloseForReceiveOutcomeAsync(socket, outcome.Value);
        return null;
    }

    private static async Task<LoopOutcome> SendTerminalAndCloseAsync(WebSocket socket,
        RealtimeSnapshotMailbox mailbox, RealtimeOutbound outbound, CancellationToken cancellationToken)
    {
        var remaining = RemainingTerminalTime(mailbox);
        if (remaining <= TimeSpan.Zero)
        {
            socket.Abort();
            return LoopOutcome.TerminalTimedOut;
        }
        using var terminal = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        terminal.CancelAfter(remaining);
        try
        {
            var payload = System.Text.Encoding.UTF8.GetBytes(outbound.Json);
            await socket.SendAsync(payload, WebSocketMessageType.Text, true, terminal.Token);
        }
        catch (OperationCanceledException)
        {
            socket.Abort();
            return LoopOutcome.TerminalTimedOut;
        }
        catch (WebSocketException)
        {
            socket.Abort();
            return LoopOutcome.TerminalTimedOut;
        }

        await CloseOutputBoundedAsync(
            socket, WebSocketCloseStatus.NormalClosure, null, CloseOutputTimeout);
        return LoopOutcome.Terminal;
    }

    private static async Task<LoopOutcome> CloseForReceiveOutcomeAsync(
        WebSocket socket, LoopOutcome outcome)
    {
        if (outcome == LoopOutcome.PeerClosed)
        {
            await CloseOutputBoundedAsync(socket,
                socket.CloseStatus ?? WebSocketCloseStatus.NormalClosure,
                socket.CloseStatusDescription, CloseOutputTimeout);
            return outcome;
        }
        if (outcome == LoopOutcome.Cancelled)
        {
            socket.Abort();
            return outcome;
        }
        var status = outcome == LoopOutcome.InvalidPayload
            ? WebSocketCloseStatus.InvalidPayloadData
            : WebSocketCloseStatus.EndpointUnavailable;
        await CloseOutputBoundedAsync(socket, status,
            outcome == LoopOutcome.Overloaded ? "overloaded" : null, CloseOutputTimeout);
        return outcome;
    }

    private static TimeSpan RemainingTerminalTime(RealtimeSnapshotMailbox mailbox) =>
        TerminalSendTimeout - Stopwatch.GetElapsedTime(mailbox.TerminalAvailableTimestamp);

    private static Task WaitForCancellationAsync(CancellationToken cancellationToken) =>
        Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);

    internal static async Task CloseOutputBoundedAsync(WebSocket socket,
        WebSocketCloseStatus status, string? description, TimeSpan timeout)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        try
        {
            await socket.CloseOutputAsync(status, description, cancellation.Token);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            socket.Abort();
        }
        catch (WebSocketException)
        {
            socket.Abort();
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

    private static async Task ObserveIoAsync(Task task)
    {
        try { await task; }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
    }

    internal enum LoopOutcome
    {
        Cancelled, PeerClosed, InvalidPayload, Overloaded, Terminal, TerminalTimedOut
    }
}

internal sealed class RealtimeGameEndpointHooks
{
    public Func<TicketScope, Task>? BeforeRevalidateAsync { get; init; }
    public Action<RealtimeSnapshotMailbox>? AfterAttach { get; init; }
}
