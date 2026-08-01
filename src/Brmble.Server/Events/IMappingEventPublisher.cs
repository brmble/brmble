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

    /// <summary>
    /// As <see cref="PublishAsync"/>, but the payload is not delivered to
    /// <paramref name="excluded"/>. Used by the registration path, where the joining socket's
    /// own snapshot already carries the mapping being announced.
    /// </summary>
    Task PublishExceptAsync(
        System.Net.WebSockets.WebSocket excluded,
        Func<bool> mutate,
        Func<MappingEnvelope, object> payload);
}
