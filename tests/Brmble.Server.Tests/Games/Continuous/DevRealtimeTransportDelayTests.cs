using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using Brmble.Server.Games.Continuous;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class DevRealtimeTransportDelayTests
{
    [TestMethod]
    public void NoneIsDisabledAndWrapsToTheSameSocket()
    {
        var inner = new RecordingWebSocket();

        Assert.IsFalse(DevRealtimeTransportDelay.None.Enabled);
        Assert.AreSame(inner, DevRealtimeTransportDelay.None.Wrap(inner));
    }

    [TestMethod]
    public async Task SendsArePipelinedInOrderEachDelayedByTheConfiguredAmountNotSerialised()
    {
        var inner = new RecordingWebSocket();
        var delay = new DevRealtimeTransportDelay(TimeSpan.FromMilliseconds(60), TimeSpan.Zero);
        using var socket = delay.Wrap(inner);
        var started = Stopwatch.GetTimestamp();

        // Three messages 5 ms apart. Serialising the delay would deliver them at ~60,
        // ~120 and ~180 ms; a pipeline delivers each ~60 ms after its own send.
        for (var index = 0; index < 3; index++)
        {
            await socket.SendAsync(Encoding.UTF8.GetBytes($"m{index}"), WebSocketMessageType.Text, true, default);
            await Task.Delay(5);
        }
        await inner.WaitForSendsAsync(3, TimeSpan.FromSeconds(2));

        CollectionAssert.AreEqual(new[] { "m0", "m1", "m2" }, inner.Sends.Select(x => x.Text).ToArray());
        var last = Stopwatch.GetElapsedTime(started, inner.Sends[2].Timestamp);
        Assert.IsTrue(last >= TimeSpan.FromMilliseconds(60), $"third message left after {last.TotalMilliseconds} ms");
        Assert.IsTrue(last < TimeSpan.FromMilliseconds(150), $"sends were serialised: third left after {last.TotalMilliseconds} ms");
    }

    [TestMethod]
    public async Task ReceiveIsDelayedAndCloseOutputDrainsPendingSendsFirst()
    {
        var inner = new RecordingWebSocket();
        inner.QueueReceive("hello");
        var delay = new DevRealtimeTransportDelay(TimeSpan.FromMilliseconds(40), TimeSpan.Zero);
        using var socket = delay.Wrap(inner);

        var started = Stopwatch.GetTimestamp();
        var buffer = new byte[64];
        var received = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), default);
        Assert.IsTrue(Stopwatch.GetElapsedTime(started) >= TimeSpan.FromMilliseconds(40));
        Assert.AreEqual("hello", Encoding.UTF8.GetString(buffer, 0, received.Count));

        await socket.SendAsync(Encoding.UTF8.GetBytes("terminal"), WebSocketMessageType.Text, true, default);
        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "done", default);

        Assert.AreEqual(1, inner.Sends.Count, "the pending send must leave before the close frame");
        Assert.IsTrue(inner.OutputClosed);
    }

    private sealed class RecordingWebSocket : WebSocket
    {
        private readonly Queue<byte[]> _receives = new();
        public List<(long Timestamp, string Text)> Sends { get; } = [];
        public bool OutputClosed { get; private set; }

        public void QueueReceive(string text) => _receives.Enqueue(Encoding.UTF8.GetBytes(text));

        public async Task WaitForSendsAsync(int count, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (Sends.Count < count)
            {
                if (DateTime.UtcNow > deadline) throw new AssertFailedException($"only {Sends.Count} sends arrived");
                await Task.Delay(5);
            }
        }

        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => WebSocketState.Open;
        public override string? SubProtocol => null;
        public override void Abort() { }
        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            OutputClosed = true;
            return Task.CompletedTask;
        }
        public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            OutputClosed = true;
            return Task.CompletedTask;
        }
        public override void Dispose() { }
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken cancellationToken)
        {
            var payload = _receives.Dequeue();
            payload.CopyTo(buffer.Array!, buffer.Offset);
            return Task.FromResult(new WebSocketReceiveResult(payload.Length, WebSocketMessageType.Text, true));
        }
        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken cancellationToken)
        {
            lock (Sends) Sends.Add((Stopwatch.GetTimestamp(), Encoding.UTF8.GetString(buffer)));
            return Task.CompletedTask;
        }
    }
}
