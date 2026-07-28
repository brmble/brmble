using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class BrmbleEventBusTests
{
    private BrmbleEventBus _bus = null!;
    private Mock<IChannelMembershipService> _channelMembership = null!;
    private Mock<ISessionMappingService> _sessionMapping = null!;

    [TestInitialize]
    public void Setup()
    {
        _channelMembership = new Mock<IChannelMembershipService>();
        _sessionMapping = new Mock<ISessionMappingService>();
        _bus = CreateBus();
    }

    private BrmbleEventBus CreateBus(int? socketQueueCapacity = null)
    {
        var settings = new EventBusSettings();
        if (socketQueueCapacity is { } capacity)
            settings = new EventBusSettings { SocketQueueCapacity = capacity };

        return new BrmbleEventBus(
            NullLogger<BrmbleEventBus>.Instance,
            _channelMembership.Object,
            _sessionMapping.Object,
            Options.Create(settings));
    }

    [TestMethod]
    public async Task BroadcastAsync_SendsToAllOpenClients()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 2L);

        await _bus.BroadcastAsync(new { type = "test" });

        ws1.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
        ws2.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesClosedClients()
    {
        var dead = CreateMockWebSocket(WebSocketState.Closed);
        await _bus.AddClientAsync(dead.Object, 1L);

        await _bus.BroadcastAsync(new { type = "test" });

        dead.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesClientOnSendError()
    {
        var failing = CreateMockWebSocket(WebSocketState.Open);
        failing.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .ThrowsAsync(new WebSocketException("connection reset"));
        await _bus.AddClientAsync(failing.Object, 1L);

        await _bus.BroadcastAsync(new { type = "first" });

        var healthy = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(healthy.Object, 2L);
        await _bus.BroadcastAsync(new { type = "second" });

        healthy.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_NoClientsDoesNotThrow()
    {
        await _bus.BroadcastAsync(new { type = "test" });
    }

    [TestMethod]
    public async Task RemoveClient_IsIdempotent()
    {
        var ws = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws.Object, 1L);
        _bus.RemoveClient(ws.Object);
        _bus.RemoveClient(ws.Object);
    }

    [TestMethod]
    public async Task HasConnectedClient_TracksRemainingClientsForUser()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 1L);

        _bus.RemoveClient(ws1.Object);

        Assert.IsTrue(_bus.HasConnectedClient(1L));

        _bus.RemoveClient(ws2.Object);

        Assert.IsFalse(_bus.HasConnectedClient(1L));
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_SendsOnlyToUsersInChannel()
    {
        // Set up channel membership: channel 5 has sessions 10 and 20
        _channelMembership.Setup(c => c.GetSessionsInChannel(5))
            .Returns(new List<int> { 10, 20 });

        // Set up session mapping: session 10 -> userId 1, session 20 -> userId 2
        _sessionMapping.Setup(s => s.GetSnapshot())
            .Returns(new Dictionary<int, SessionMapping>
            {
                { 10, new SessionMapping("@user1:matrix.org", "User1", 1L, "bee") },
                { 20, new SessionMapping("@user2:matrix.org", "User2", 2L, "bee") }
            });

        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        var ws3 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 2L);
        await _bus.AddClientAsync(ws3.Object, 3L); // Not in channel

        await _bus.BroadcastToChannelAsync(5, new { type = "channelEvent" });

        // WS1 and WS2 should receive the message
        ws1.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
        ws2.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);

        // WS3 should NOT receive the message
        ws3.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_EmptyChannel_SendsToNobody()
    {
        // Set up empty channel
        _channelMembership.Setup(c => c.GetSessionsInChannel(99))
            .Returns(new List<int>());

        _sessionMapping.Setup(s => s.GetSnapshot())
            .Returns(new Dictionary<int, SessionMapping>());

        var ws = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws.Object, 1L);

        await _bus.BroadcastToChannelAsync(99, new { type = "channelEvent" });

        // WS should NOT receive anything
        ws.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastAsync_DoesNotOverlapSendsOnTheSameSocket()
    {
        // WebSocket.SendAsync is not thread-safe: a second concurrent call on the same
        // socket throws "There is already one outstanding 'SendAsync' call". Independent
        // broadcasts (e.g. screen share and session mapping) must not collide.
        var tracker = new ConcurrencyTracker();
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() => tracker.RecordSendAsync());
        await _bus.AddClientAsync(ws.Object, 1L);

        var first = _bus.BroadcastAsync(new { type = "screenShare.stopped" });
        var second = _bus.BroadcastAsync(new { type = "userMappingAdded" });
        await Task.WhenAll(first, second);

        Assert.AreEqual(1, tracker.MaxConcurrent, "Sends to a single socket must be serialized.");
        Assert.AreEqual(2, tracker.TotalSends);
    }

    [TestMethod]
    public async Task RemoveClient_CompletesQueuedBroadcastsWithoutWaitingForTheSocket()
    {
        // Serializing sends means a stalled socket can hold a queue behind it. When the
        // client goes away, everything still queued must be released instead of waiting
        // on a socket that will never drain.
        var release = new TaskCompletionSource();
        var firstSendStarted = new TaskCompletionSource();
        var sendCount = 0;
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                if (Interlocked.Increment(ref sendCount) == 1)
                {
                    firstSendStarted.TrySetResult();
                    return release.Task;
                }

                return Task.CompletedTask;
            });
        await _bus.AddClientAsync(ws.Object, 1L);

        var blocked = _bus.BroadcastAsync(new { type = "first" });
        await firstSendStarted.Task;
        var queued = _bus.BroadcastAsync(new { type = "second" });

        _bus.RemoveClient(ws.Object);

        await queued.WaitAsync(TimeSpan.FromSeconds(2));

        release.TrySetResult();
        await blocked.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.AreEqual(1, Volatile.Read(ref sendCount), "A removed client must not receive queued payloads.");
    }

    [TestMethod]
    public async Task AddClientAsync_DeliversSnapshotBeforeLaterBroadcasts()
    {
        var recorded = new List<string>();
        var ws = CreateRecordingWebSocket(recorded);

        await _bus.AddClientAsync(ws.Object, 1L, () => Snapshot("sessionMappingSnapshot"));
        await _bus.BroadcastAsync(new { type = "userMappingAdded" });

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "userMappingAdded" },
            recorded,
            "The snapshot must be the first payload the client receives.");
    }

    [TestMethod]
    public async Task AddClientAsync_DoesNotDropBroadcastsRacingTheSnapshotCapture()
    {
        // The snapshot is captured from live state, so a mutation broadcast during the
        // capture may or may not be reflected in it. The client must be registered before
        // the capture, so that such a broadcast queues behind the snapshot instead of being
        // dropped for a client that is not yet visible to broadcasts. Redelivering a
        // mutation the snapshot already contains is harmless; losing it is not.
        var recorded = new List<string>();
        var ws = CreateRecordingWebSocket(recorded);
        Task racing = Task.CompletedTask;

        await _bus.AddClientAsync(ws.Object, 1L, () =>
        {
            // BroadcastAsync enqueues synchronously before returning its task, so by the
            // time this assignment completes the payload is queued for this socket.
            racing = _bus.BroadcastAsync(new { type = "userMappingAdded" });
            return Snapshot("sessionMappingSnapshot");
        });
        await racing.WaitAsync(TimeSpan.FromSeconds(2));

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "userMappingAdded" },
            recorded,
            "A broadcast racing the snapshot capture must be delivered after the snapshot, not dropped.");
    }

    [TestMethod]
    public async Task AddClientAsync_FailingSnapshotFactoryUnregistersTheClient()
    {
        var ws = CreateMockWebSocket(WebSocketState.Open);

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(
            () => _bus.AddClientAsync(ws.Object, 1L, () => throw new InvalidOperationException("boom")));

        Assert.IsFalse(_bus.HasConnectedClient(1L), "A client whose snapshot failed must not stay registered.");

        // The bus must remain usable and must not try to send to the abandoned socket.
        await _bus.BroadcastAsync(new { type = "test" });
        ws.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task AddClientAsync_QueueOverflowDuringSnapshotBuildFaultsRegistration()
    {
        // The client is registered before the snapshot is built, so broadcasts arriving
        // during the build can overflow its queue and drop it. Registration must observe
        // that and fault instead of queuing a snapshot behind a failed delivery, which
        // would never drain and would hang the WebSocket request forever.
        var bus = CreateBus(socketQueueCapacity: 1);
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() => new TaskCompletionSource().Task);

        var registration = bus.AddClientAsync(ws.Object, 1L, () =>
        {
            // Capacity is 1 and nothing is draining yet, so the second broadcast overflows.
            _ = bus.BroadcastAsync(new { type = "event0" });
            _ = bus.BroadcastAsync(new { type = "event1" });
            return Snapshot("sessionMappingSnapshot");
        });

        await Assert.ThrowsExceptionAsync<WebSocketException>(
            () => registration.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.IsFalse(bus.HasConnectedClient(1L), "An overflowed client must not stay registered.");
    }

    [TestMethod]
    public async Task BroadcastAsync_FullQueueDisconnectsSlowClientAndLeavesOthersHealthy()
    {
        // A client that stops draining must not grow its queue without bound. It is
        // disconnected so it reconnects and resyncs from a fresh snapshot, and that must
        // not disturb delivery to anyone else or fault the broadcast callers.
        var bus = CreateBus(socketQueueCapacity: 2);
        var release = new TaskCompletionSource();
        var slow = CreateMockWebSocket(WebSocketState.Open);
        slow.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() => release.Task);
        // Abort tears down the in-flight send, as a real socket would.
        slow.Setup(w => w.Abort())
            .Callback(() => release.TrySetException(new WebSocketException("aborted")));

        var healthyPayloads = new List<string>();
        var healthy = CreateRecordingWebSocket(healthyPayloads);

        await bus.AddClientAsync(slow.Object, 1L);
        await bus.AddClientAsync(healthy.Object, 2L);

        // One send in flight plus two queued fills the capacity; the fourth overflows.
        var broadcasts = new List<Task>();
        for (var i = 0; i < 4; i++)
            broadcasts.Add(bus.BroadcastAsync(new { type = $"event{i}" }));

        await Task.WhenAll(broadcasts).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.IsFalse(bus.HasConnectedClient(1L), "The overflowing client must be disconnected.");
        slow.Verify(w => w.Abort(), Times.Once);

        Assert.IsTrue(bus.HasConnectedClient(2L), "A healthy client must survive another client overflowing.");
        CollectionAssert.AreEqual(
            new[] { "event0", "event1", "event2", "event3" },
            healthyPayloads,
            "A healthy client must receive every broadcast regardless of another client overflowing.");
    }

    [TestMethod]
    public async Task BroadcastAsync_FullQueueDoesNotThrowToTheCaller()
    {
        // Callers such as the auth and LiveKit endpoints await broadcasts without guarding
        // them. An overflowing client must never surface as a failed request for someone else.
        var bus = CreateBus(socketQueueCapacity: 1);
        var release = new TaskCompletionSource();
        var slow = CreateMockWebSocket(WebSocketState.Open);
        slow.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() => release.Task);
        slow.Setup(w => w.Abort())
            .Callback(() => release.TrySetException(new WebSocketException("aborted")));

        await bus.AddClientAsync(slow.Object, 1L);

        var broadcasts = new List<Task>();
        for (var i = 0; i < 3; i++)
            broadcasts.Add(bus.BroadcastAsync(new { type = $"event{i}" }));

        // Must complete, not fault.
        await Task.WhenAll(broadcasts).WaitAsync(TimeSpan.FromSeconds(5));
    }

    [TestMethod]
    public async Task BroadcastAsync_SendFailureTearsDownTheClientWithoutRetryingTheRestOfTheQueue()
    {
        // A socket that fails a send is broken for every payload behind it. The drain must
        // fail the whole delivery rather than walking the queue and burning a five second
        // timeout per payload, and it must tear the socket down itself instead of relying
        // on a caller noticing the fault.
        var bus = CreateBus(socketQueueCapacity: 10);
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .ThrowsAsync(new WebSocketException("socket is broken"));

        await bus.AddClientAsync(ws.Object, 1L);

        var broadcasts = new List<Task>();
        for (var i = 0; i < 3; i++)
            broadcasts.Add(bus.BroadcastAsync(new { type = $"event{i}" }));

        await Task.WhenAll(broadcasts).WaitAsync(TimeSpan.FromSeconds(5));

        ws.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()),
            Times.Once,
            "Payloads queued behind a failed send must not each be retried against the broken socket.");
        Assert.IsFalse(bus.HasConnectedClient(1L), "A client whose send failed must be deregistered by the drain.");
        ws.Verify(w => w.Abort(), Times.Once);
    }

    [TestMethod]
    public void Constructor_RejectsNonPositiveQueueCapacity()
    {
        // A misconfigured capacity of zero would overflow on the first send and disconnect
        // every client, so fail at startup rather than at runtime.
        Assert.ThrowsException<ArgumentOutOfRangeException>(() => CreateBus(socketQueueCapacity: 0));
    }

    [TestMethod]
    public async Task AddClientAsync_DeliversEveryInitialPayloadInOrderAheadOfRacingBroadcasts()
    {
        // A duel client bootstraps on two payloads, not one. Both have to reach the head of
        // the queue, in order, or the queue snapshot is interpreted against a stale mapping.
        var recorded = new List<string>();
        var socket = CreateRecordingWebSocket(recorded);
        var buildEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseBuild = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var registration = _bus.AddClientAsync(socket.Object, 1L, async () =>
        {
            buildEntered.TrySetResult();
            await releaseBuild.Task;
            return new object[]
            {
                new { type = "sessionMappingSnapshot" },
                new { type = "game.queueSnapshot" },
            };
        });

        await buildEntered.Task;
        var racing = _bus.BroadcastAsync(new { type = "duringBuild" });
        Assert.AreEqual(0, recorded.Count, "nothing may be sent before the initial payloads");

        releaseBuild.TrySetResult();
        await registration;
        await racing;
        await _bus.BroadcastAsync(new { type = "afterBuild" });

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "game.queueSnapshot", "duringBuild", "afterBuild" },
            recorded);
    }

    [TestMethod]
    public async Task BroadcastExceptAsync_SkipsTheExcludedClientAndReachesTheRest()
    {
        // The registering client's own snapshot already carries the mapping being announced,
        // so it must not also receive the announcement as a separate event.
        var excludedSends = new List<string>();
        var otherSends = new List<string>();
        var excluded = CreateRecordingWebSocket(excludedSends);
        var other = CreateRecordingWebSocket(otherSends);
        await _bus.AddClientAsync(excluded.Object, 1L);
        await _bus.AddClientAsync(other.Object, 2L);

        await _bus.BroadcastExceptAsync(excluded.Object, new { type = "userMappingAdded" });

        Assert.AreEqual(0, excludedSends.Count);
        CollectionAssert.AreEqual(new[] { "userMappingAdded" }, otherSends);
    }

    /// <summary>Wraps a single payload as the initial batch a registration hands back.</summary>
    private static Task<IReadOnlyList<object>> Snapshot(string type) =>
        Task.FromResult<IReadOnlyList<object>>([new { type }]);

    private static Mock<WebSocket> CreateRecordingWebSocket(List<string> recorded)
    {
        var mock = new Mock<WebSocket>();
        mock.Setup(w => w.State).Returns(WebSocketState.Open);
        mock.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns((ArraySegment<byte> buffer, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                var type = JsonDocument.Parse(Encoding.UTF8.GetString(buffer))
                    .RootElement.GetProperty("type").GetString()!;
                lock (recorded)
                {
                    recorded.Add(type);
                }

                return Task.CompletedTask;
            });
        return mock;
    }

    private sealed class ConcurrencyTracker
    {
        private readonly object _gate = new();
        private int _current;

        public int MaxConcurrent { get; private set; }
        public int TotalSends { get; private set; }

        public async Task RecordSendAsync()
        {
            lock (_gate)
            {
                _current++;
                TotalSends++;
                if (_current > MaxConcurrent)
                    MaxConcurrent = _current;
            }

            await Task.Delay(25);

            lock (_gate)
            {
                _current--;
            }
        }
    }

    private static Mock<WebSocket> CreateMockWebSocket(WebSocketState state)
    {
        var mock = new Mock<WebSocket>();
        mock.Setup(w => w.State).Returns(state);
        mock.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return mock;
    }
}
