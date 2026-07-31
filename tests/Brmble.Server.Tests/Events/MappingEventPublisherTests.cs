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
        public bool HasConnectedClient(long userId) => false;
        public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync() =>
            Task.FromResult<IReadOnlySet<long>>(new HashSet<long>());
        public Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message, EventDeliveryOptions options = default) =>
            BroadcastAsync(message);
    }
}
