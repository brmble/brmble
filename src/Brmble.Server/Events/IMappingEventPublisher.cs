namespace Brmble.Server.Events;

public interface IMappingEventPublisher
{
    /// <summary>
    /// Runs <paramref name="mutate"/> and, only if it reports a change, broadcasts the payload
    /// built from the resulting envelope. Mutation and broadcast admission happen under one
    /// lock, so revision order always matches delivery order.
    /// </summary>
    /// <param name="mutate">Performs the mutation; returns false if nothing changed.</param>
    /// <param name="payload">Builds the payload from the post-mutation envelope.</param>
    Task PublishAsync(Func<bool> mutate, Func<MappingEnvelope, object> payload);
}
