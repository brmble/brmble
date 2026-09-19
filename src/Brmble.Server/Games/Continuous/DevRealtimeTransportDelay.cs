using System.Diagnostics;
using System.Net.WebSockets;
using System.Threading.Channels;

namespace Brmble.Server.Games.Continuous;

/// <summary>
/// Development-only. Adds artificial one-way latency to a realtime game socket in
/// both directions, so client-side prediction can be exercised on one machine.
/// </summary>
/// <remarks>
/// On a developer's desk the round trip is under a millisecond, and every defect in
/// how the client predicts its own inputs across a real round trip is invisible;
/// <see cref="DevClockSkewTimeProvider"/> covers clock disagreement but not latency.
/// This wraps the accepted <see cref="WebSocket"/>: each received message is held for
/// the configured delay before the endpoint sees it (uplink), and each sent message
/// is held for the delay before it goes out (downlink), in order, without stalling
/// the writer loop - a send completes as soon as it is queued, and a pump delivers it
/// when due. Jitter, when set, adds a uniform random 0..jitter ms per message; due
/// times are kept monotonic so jitter can never reorder.
///
/// Closing the output waits for the pump to drain, so the terminal message is still
/// delivered before the close frame. Backpressure from the socket is lost while the
/// delay is active; that is acceptable for a local testing aid and is the reason it
/// is pinned to zero outside Development in <c>Program.cs</c>.
/// </remarks>
public sealed class DevRealtimeTransportDelay(TimeSpan delay, TimeSpan jitter)
{
    public static DevRealtimeTransportDelay None { get; } = new(TimeSpan.Zero, TimeSpan.Zero);

    public TimeSpan Delay { get; } = delay;
    public TimeSpan Jitter { get; } = jitter;
    public bool Enabled => Delay > TimeSpan.Zero || Jitter > TimeSpan.Zero;

    public WebSocket Wrap(WebSocket socket) => Enabled ? new DelayedWebSocket(socket, this) : socket;

    internal TimeSpan NextDelay(Random random) =>
        Delay + (Jitter > TimeSpan.Zero ? TimeSpan.FromMilliseconds(random.NextDouble() * Jitter.TotalMilliseconds) : TimeSpan.Zero);

    private sealed class DelayedWebSocket : WebSocket
    {
        private readonly WebSocket _inner;
        private readonly DevRealtimeTransportDelay _delay;
        private readonly Random _random = new();
        private readonly Channel<Outbound> _outbound = Channel.CreateUnbounded<Outbound>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
        private readonly Task _pump;
        private readonly CancellationTokenSource _pumpCancellation = new();
        private readonly object _dueGate = new();
        private long _lastDueTimestamp;

        public DelayedWebSocket(WebSocket inner, DevRealtimeTransportDelay delay)
        {
            _inner = inner;
            _delay = delay;
            _pump = Task.Run(PumpAsync);
        }

        private readonly record struct Outbound(
            long DueTimestamp, byte[] Payload, WebSocketMessageType MessageType, bool EndOfMessage);

        public override WebSocketCloseStatus? CloseStatus => _inner.CloseStatus;
        public override string? CloseStatusDescription => _inner.CloseStatusDescription;
        public override WebSocketState State => _inner.State;
        public override string? SubProtocol => _inner.SubProtocol;

        public override void Abort()
        {
            _pumpCancellation.Cancel();
            _outbound.Writer.TryComplete();
            _inner.Abort();
        }

        public override async Task CloseAsync(
            WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            await DrainAsync(cancellationToken);
            await _inner.CloseAsync(closeStatus, statusDescription, cancellationToken);
        }

        public override async Task CloseOutputAsync(
            WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            await DrainAsync(cancellationToken);
            await _inner.CloseOutputAsync(closeStatus, statusDescription, cancellationToken);
        }

        public override void Dispose()
        {
            _pumpCancellation.Cancel();
            _outbound.Writer.TryComplete();
            _inner.Dispose();
        }

        public override async Task<WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer, CancellationToken cancellationToken)
        {
            var result = await _inner.ReceiveAsync(buffer, cancellationToken);
            // Delayed after the read so the delay is charged per message the peer sent,
            // not per buffer the endpoint offered. A multi-fragment message pays once per
            // fragment; the client never fragments its small frames.
            if (result.MessageType != WebSocketMessageType.Close)
                await Task.Delay(_delay.NextDelay(_random), cancellationToken);
            return result;
        }

        public override Task SendAsync(
            ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var payload = buffer.ToArray();
            long due;
            lock (_dueGate)
            {
                var candidate = Stopwatch.GetTimestamp()
                    + (long)(_delay.NextDelay(_random).TotalSeconds * Stopwatch.Frequency);
                due = Math.Max(candidate, _lastDueTimestamp);
                _lastDueTimestamp = due;
            }
            if (!_outbound.Writer.TryWrite(new Outbound(due, payload, messageType, endOfMessage)))
                throw new WebSocketException(WebSocketError.InvalidState, "The delayed socket is closed.");
            return Task.CompletedTask;
        }

        private async Task PumpAsync()
        {
            try
            {
                await foreach (var outbound in _outbound.Reader.ReadAllAsync(_pumpCancellation.Token))
                {
                    var remaining = Stopwatch.GetElapsedTime(Stopwatch.GetTimestamp(), outbound.DueTimestamp);
                    if (remaining > TimeSpan.Zero)
                        await Task.Delay(remaining, _pumpCancellation.Token);
                    await _inner.SendAsync(
                        new ArraySegment<byte>(outbound.Payload), outbound.MessageType, outbound.EndOfMessage,
                        _pumpCancellation.Token);
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException)
            {
                _inner.Abort();
            }
        }

        private async Task DrainAsync(CancellationToken cancellationToken)
        {
            _outbound.Writer.TryComplete();
            try { await _pump.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
        }
    }
}
