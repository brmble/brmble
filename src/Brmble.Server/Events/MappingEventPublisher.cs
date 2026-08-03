namespace Brmble.Server.Events;

public sealed class MappingEventPublisher(
    ISessionMappingService mappings,
    IBrmbleEventBus eventBus) : IMappingEventPublisher
{
    private readonly object _gate = new();

    public Task PublishAsync(Func<bool> mutate, Func<MappingEnvelope, object> payload) =>
        PublishCore(mutate, payload, static (bus, message) => bus.BroadcastAsync(message), eventBus);

    public Task PublishExceptAsync(
        System.Net.WebSockets.WebSocket excluded,
        Func<bool> mutate,
        Func<MappingEnvelope, object> payload) =>
        PublishCore(mutate, payload, (bus, message) => bus.BroadcastExceptAsync(excluded, message), eventBus);

    public Task PublishSnapshotAsync(
        System.Net.WebSockets.WebSocket target,
        Func<MappingEnvelope, IReadOnlyDictionary<int, SessionMapping>, object> payload)
    {
        Task pending;
        lock (_gate)
        {
            // Revision, mappings and enqueue all happen inside the gate. A mutation racing this
            // is therefore either fully reflected in the capture and at or below the stamped
            // revision, or enqueued after the snapshot and so applies on top of it. Splitting
            // these — capturing here and enqueuing after an await — lets a later event overtake
            // the snapshot it was supposed to be repaired by.
            // A snapshot is absolute rather than a delta, so it is its own base and carries no
            // baseRevision: it sets the client's cursor outright instead of advancing it.
            var envelope = MappingEnvelope.Snapshot(mappings.InstanceId, mappings.Revision);
            pending = eventBus.SendToClientAsync(target, payload(envelope, mappings.GetSnapshot()));
        }

        return pending;
    }

    private Task PublishCore(
        Func<bool> mutate,
        Func<MappingEnvelope, object> payload,
        Func<IBrmbleEventBus, object, Task> send,
        IBrmbleEventBus bus)
    {
        Task pending;
        lock (_gate)
        {
            // Read before, mutate, read after — all inside the lock, so the range provably
            // belongs to this mutation and cannot straddle a concurrent one.
            var baseRevision = mappings.Revision;
            if (!mutate()) return Task.CompletedTask;

            var envelope = new MappingEnvelope(mappings.InstanceId, mappings.Revision, baseRevision);

            // Safe under the lock: BrmbleEventBus's broadcast paths are deliberately not async
            // and enqueue to every per-socket queue before returning, so no socket I/O happens
            // here. Awaiting inside the lock would be wrong; capturing the task is not.
            pending = send(bus, payload(envelope));
        }

        return pending;
    }
}
