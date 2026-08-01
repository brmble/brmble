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

    /// <summary>
    /// Captures the mapping table and its revision, and enqueues a snapshot built from them to a
    /// single socket — all under the same ordering gate mutations use.
    /// </summary>
    /// <remarks>
    /// The capture and the enqueue must not be separated. Reading the revision and the mappings,
    /// then awaiting anything before enqueuing, lets an event at a later revision reach the
    /// socket ahead of the snapshot. A client then either discards that event while waiting for
    /// the repair it already had, or applies it and is rolled back by the older snapshot — and
    /// nothing replays it afterwards.
    /// </remarks>
    Task PublishSnapshotAsync(
        System.Net.WebSockets.WebSocket target,
        Func<MappingEnvelope, IReadOnlyDictionary<int, SessionMapping>, object> payload);
}
