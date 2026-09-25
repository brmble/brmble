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
/// is held for the delay before it goes out (downlink), in order, and in both
/// directions without ever stalling the flow - a pump keeps reading the inner socket
/// so messages queue up with their own due times rather than each waiting its turn,
/// and a send completes as soon as it is queued and leaves when due. Delaying each
/// read in place instead would cap the uplink at one message per delay, and a client
/// that sends faster than that (every input frame does) would fall further behind for
/// as long as it played. Jitter, when set, adds a uniform random 0..jitter ms per
/// message; due times are kept monotonic so jitter can never reorder.
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
        private readonly Channel<Inbound> _inbound = Channel.CreateUnbounded<Inbound>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
        private readonly Task _pump;
        private readonly CancellationTokenSource _pumpCancellation = new();
        private readonly object _dueGate = new();
        private long _lastOutboundDue;
        private long _lastInboundDue;
        private Inbound? _partial;
        private int _partialOffset;

        public DelayedWebSocket(WebSocket inner, DevRealtimeTransportDelay delay)
        {
            _inner = inner;
            _delay = delay;
            _pump = Task.Run(PumpAsync);
            _ = Task.Run(ReceivePumpAsync);
        }

        private readonly record struct Outbound(
            long DueTimestamp, byte[] Payload, WebSocketMessageType MessageType, bool EndOfMessage);

        private readonly record struct Inbound(
            long DueTimestamp, byte[] Payload, WebSocketMessageType MessageType, bool EndOfMessage,
            WebSocketCloseStatus? CloseStatus, string? CloseStatusDescription);

        private long NextDue(ref long last)
        {
            lock (_dueGate)
            {
                var candidate = Stopwatch.GetTimestamp()
                    + (long)(_delay.NextDelay(_random).TotalSeconds * Stopwatch.Frequency);
                last = Math.Max(candidate, last);
                return last;
            }
        }

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

        // The uplink: a pump reads the inner socket continuously so every message gets
        // its own due time the moment it arrives; ReceiveAsync hands them out when due.
        private async Task ReceivePumpAsync()
        {
            var buffer = new byte[64 * 1024];
            try
            {
                while (true)
                {
                    var result = await _inner.ReceiveAsync(new ArraySegment<byte>(buffer), _pumpCancellation.Token);
                    var payload = result.Count == 0 ? Array.Empty<byte>() : buffer.AsSpan(0, result.Count).ToArray();
                    _inbound.Writer.TryWrite(new Inbound(NextDue(ref _lastInboundDue), payload, result.MessageType,
                        result.EndOfMessage, result.CloseStatus, result.CloseStatusDescription));
                    if (result.MessageType == WebSocketMessageType.Close) break;
                }
                _inbound.Writer.TryComplete();
            }
            catch (OperationCanceledException)
            {
                _inbound.Writer.TryComplete();
            }
            catch (Exception ex)
            {
                _inbound.Writer.TryComplete(ex);
            }
        }

        public override async Task<WebSocketReceiveResult> ReceiveAsync(
            ArraySegment<byte> buffer, CancellationToken cancellationToken)
        {
            if (_partial is null)
            {
                Inbound next;
                try
                {
                    next = await _inbound.Reader.ReadAsync(cancellationToken);
                }
                catch (ChannelClosedException ex)
                {
                    throw ex.InnerException ?? new WebSocketException(WebSocketError.InvalidState, "The delayed socket is closed.");
                }
                var remaining = Stopwatch.GetElapsedTime(Stopwatch.GetTimestamp(), next.DueTimestamp);
                if (remaining > TimeSpan.Zero)
                    await Task.Delay(remaining, cancellationToken);
                if (next.MessageType == WebSocketMessageType.Close)
                    return new WebSocketReceiveResult(0, WebSocketMessageType.Close, true, next.CloseStatus, next.CloseStatusDescription);
                _partial = next;
                _partialOffset = 0;
            }

            // A message larger than the caller's buffer is handed out in pieces, as the
            // inner socket would; the client's frames are a few hundred bytes.
            var item = _partial.Value;
            var count = Math.Min(buffer.Count, item.Payload.Length - _partialOffset);
            Array.Copy(item.Payload, _partialOffset, buffer.Array!, buffer.Offset, count);
            _partialOffset += count;
            var finished = _partialOffset >= item.Payload.Length;
            if (finished) _partial = null;
            return new WebSocketReceiveResult(count, item.MessageType, finished && item.EndOfMessage);
        }

        public override Task SendAsync(
            ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var payload = buffer.ToArray();
            var due = NextDue(ref _lastOutboundDue);
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
