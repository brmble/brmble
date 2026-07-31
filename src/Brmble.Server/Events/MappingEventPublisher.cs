namespace Brmble.Server.Events;

public sealed class MappingEventPublisher(
    ISessionMappingService mappings,
    IBrmbleEventBus eventBus) : IMappingEventPublisher
{
    private readonly object _gate = new();

    public Task PublishAsync(Func<bool> mutate, Func<MappingEnvelope, object> payload)
    {
        Task send;
        lock (_gate)
        {
            if (!mutate()) return Task.CompletedTask;

            var envelope = new MappingEnvelope(mappings.InstanceId, mappings.Revision);

            // Safe under the lock: BrmbleEventBus.BroadcastCoreAsync is deliberately not async
            // and enqueues to every per-socket queue before returning, so no socket I/O happens
            // here. Awaiting inside the lock would be wrong; capturing the task is not.
            send = eventBus.BroadcastAsync(payload(envelope));
        }

        return send;
    }
}
