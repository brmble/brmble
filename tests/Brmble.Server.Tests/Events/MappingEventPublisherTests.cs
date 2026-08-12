using System.Text.Json;
using Brmble.Server.Events;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class MappingEventPublisherTests
{
    private SessionMappingService _mappings = null!;
    private RecordingEventBus _bus = null!;
    private MappingEventPublisher _publisher = null!;

    [TestInitialize]
    public void Setup()
    {
        _mappings = new SessionMappingService();
        _bus = new RecordingEventBus();
        _publisher = new MappingEventPublisher(_mappings, _bus);
        _mappings.TryAddMatrixUser(1, "@alice:test", "Alice", 1L, "floppy");
    }

    [TestMethod]
    public async Task PublishAsync_StampsPayloadWithInstanceIdAndPostMutationRevision()
    {
        await _publisher.PublishAsync(
            () => _mappings.TryUpdateCompanionId(1, "retro"),
            envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_bus.Broadcasts.Single()));
        Assert.AreEqual(_mappings.InstanceId, doc.RootElement.GetProperty("instanceId").GetString());
        Assert.AreEqual(_mappings.Revision, doc.RootElement.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public async Task PublishAsync_DoesNotBroadcastWhenMutationReportsNoChange()
    {
        await _publisher.PublishAsync(
            () => _mappings.TryUpdateCompanionId(999, "retro"),
            envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision });

        Assert.AreEqual(0, _bus.Broadcasts.Count);
    }

    [TestMethod]
    public async Task PublishAsync_DeliversInRevisionOrderUnderConcurrency()
    {
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(() =>
            _publisher.PublishAsync(
                () => _mappings.TryUpdateCompanionId(1, $"c{i}"),
                envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision }))));

        var revisions = _bus.Broadcasts
            .Select(p => JsonDocument.Parse(JsonSerializer.Serialize(p))
                .RootElement.GetProperty("revision").GetInt64())
            .ToList();

        Assert.AreEqual(100, revisions.Count);
        CollectionAssert.AreEqual(revisions.OrderBy(r => r).ToList(), revisions,
            "enqueue order must match revision order, or clients discard newer payloads as duplicates");
    }

    [TestMethod]
    public async Task PublishSnapshotAsync_StampsASnapshotEnvelopeThatIsItsOwnBase()
    {
        // The resync path is a second way to deliver a snapshot, added after the envelope rules
        // were written. A snapshot is absolute, not a delta: it sets the client's cursor rather
        // than advancing it, so it must be its own base and must carry no baseRevision on the
        // wire. Stamping a real range here would make the client treat a repair as a delta and
        // leave the gap it was sent to close.
        _mappings.TryUpdateCompanionId(1, "retro");
        var socket = new Moq.Mock<System.Net.WebSockets.WebSocket>().Object;
        MappingEnvelope captured = default;

        await _publisher.PublishSnapshotAsync(socket, (envelope, snapshot) =>
        {
            captured = envelope;
            return Brmble.Server.WebSockets.BrmbleWebSocketHandler
                .CreateSessionMappingSnapshotPayload(snapshot, envelope);
        });

        Assert.AreEqual(captured.Revision, captured.BaseRevision,
            "a snapshot is its own base");
        MappingPayloadEnvelopeTests.AssertHasSnapshotEnvelope(
            _bus.Broadcasts.Single(), "sessionMappingSnapshot");
    }

    [TestMethod]
    public async Task PublishAsync_StampsTheRevisionRangeTheMutationSpanned()
    {
        // One logical operation may bump several times. baseRevision is the revision before
        // the mutation, revision the one after, so a client can apply on "baseRevision ==
        // ours" without caring how many bumps happened in between.
        var before = _mappings.Revision;

        await _publisher.PublishAsync(
            () =>
            {
                _mappings.TryUpdateCompanionId(1, "retro");
                _mappings.TryUpdateCertHash(1, "abc");
                return true;
            },
            envelope => new
            {
                type = "companionChanged",
                instanceId = envelope.InstanceId,
                baseRevision = envelope.BaseRevision,
                revision = envelope.Revision
            });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_bus.Broadcasts.Single()));
        Assert.AreEqual(before, doc.RootElement.GetProperty("baseRevision").GetInt64());
        Assert.AreEqual(before + 2, doc.RootElement.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public async Task PublishAsync_RangesAreContiguousUnderConcurrency()
    {
        // Each event's baseRevision must equal the previous event's revision, or a client
        // applying on "baseRevision == ours" stalls and resyncs forever.
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(() =>
            _publisher.PublishAsync(
                () => _mappings.TryUpdateCompanionId(1, $"c{i}"),
                envelope => new
                {
                    type = "companionChanged",
                    instanceId = envelope.InstanceId,
                    baseRevision = envelope.BaseRevision,
                    revision = envelope.Revision
                }))));

        var ranges = _bus.Broadcasts
            .Select(p => JsonDocument.Parse(JsonSerializer.Serialize(p)).RootElement)
            .Select(e => (Base: e.GetProperty("baseRevision").GetInt64(),
                          Rev: e.GetProperty("revision").GetInt64()))
            .ToList();

        Assert.AreEqual(100, ranges.Count);
        for (var i = 1; i < ranges.Count; i++)
            Assert.AreEqual(ranges[i - 1].Rev, ranges[i].Base,
                $"event {i} does not start where event {i - 1} ended");
    }

    private sealed class RecordingEventBus : IBrmbleEventBus
    {
        private readonly object _gate = new();
        public List<object> Broadcasts { get; } = new();

        public Task BroadcastAsync(object message)
        {
            // Mirrors BrmbleEventBus: admission happens synchronously on the calling thread.
            lock (_gate) Broadcasts.Add(message);
            return Task.CompletedTask;
        }

        public Task BroadcastToChannelAsync(int channelId, object message) => BroadcastAsync(message);
        public Task SendToClientAsync(System.Net.WebSockets.WebSocket socket, object message) => BroadcastAsync(message);
        public Task BroadcastExceptAsync(System.Net.WebSockets.WebSocket excluded, object message) => BroadcastAsync(message);
        public Task AddClientAsync(System.Net.WebSockets.WebSocket ws, long userId, Func<Task<IReadOnlyList<object>>>? initialMessages = null) => Task.CompletedTask;
        public void RemoveClient(System.Net.WebSockets.WebSocket ws) { }
        public DisconnectSnapshot? RemoveClientAndGetDisconnect(System.Net.WebSockets.WebSocket ws) => null;
        public bool IsCurrentEmptyDisconnect(DisconnectSnapshot snapshot) => false;
        public bool HasConnectedClient(long userId) => false;
        public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync() =>
            Task.FromResult<IReadOnlySet<long>>(new HashSet<long>());
        public Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message, EventDeliveryOptions options = default) =>
            BroadcastAsync(message);
    }

    [TestMethod]
    public void PublishSnapshotAsync_CapturesRevisionAndMappingsAndEnqueuesUnderOneGate()
    {
        // The capture and the enqueue must not be separable. If a mutation could land between
        // them, an event at a later revision could reach the socket ahead of the snapshot it was
        // supposed to be repaired by.
        _mappings.TryUpdateCompanionId(1, "retro");
        var socket = new Moq.Mock<System.Net.WebSockets.WebSocket>().Object;

        _publisher.PublishSnapshotAsync(socket, (envelope, snapshot) => new
        {
            type = "sessionMappingSnapshot",
            instanceId = envelope.InstanceId,
            revision = envelope.Revision,
            count = snapshot.Count,
            companion = snapshot[1].CompanionId
        });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_bus.Broadcasts.Single()));
        Assert.AreEqual(_mappings.Revision, doc.RootElement.GetProperty("revision").GetInt64());
        Assert.AreEqual(_mappings.InstanceId, doc.RootElement.GetProperty("instanceId").GetString());
        Assert.AreEqual("retro", doc.RootElement.GetProperty("companion").GetString(),
            "the snapshot must reflect the state at the revision it claims");
    }

    [TestMethod]
    public async Task PublishSnapshotAsync_NoEventCanBeEnqueuedBetweenTheCaptureAndTheSnapshot()
    {
        // Hammer both paths concurrently. Every snapshot's claimed revision must match the
        // mapping state it carries, and never trail an event that was already delivered.
        var socket = new Moq.Mock<System.Net.WebSockets.WebSocket>().Object;

        await Task.WhenAll(
            Task.Run(() =>
            {
                for (var i = 0; i < 200; i++)
                    _publisher.PublishAsync(
                        () => _mappings.TryUpdateCompanionId(1, $"c{i}"),
                        envelope => new
                        {
                            type = "companionChanged",
                            revision = envelope.Revision,
                            companion = _mappings.GetSnapshot()[1].CompanionId
                        });
            }),
            Task.Run(() =>
            {
                for (var i = 0; i < 200; i++)
                    _publisher.PublishSnapshotAsync(socket, (envelope, snapshot) => new
                    {
                        type = "sessionMappingSnapshot",
                        revision = envelope.Revision,
                        companion = snapshot[1].CompanionId
                    });
            }));

        // Enqueue order is delivery order, so revisions must never go backwards across the
        // combined stream of events and snapshots.
        var revisions = _bus.Broadcasts
            .Select(p => JsonDocument.Parse(JsonSerializer.Serialize(p))
                .RootElement.GetProperty("revision").GetInt64())
            .ToList();

        Assert.AreEqual(400, revisions.Count);
        CollectionAssert.AreEqual(revisions.OrderBy(r => r).ToList(), revisions,
            "a snapshot delivered after a newer event rolls the client back and is never replayed");
    }
}
