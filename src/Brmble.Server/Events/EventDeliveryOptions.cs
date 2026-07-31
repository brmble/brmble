namespace Brmble.Server.Events;

/// <summary>
/// Per-broadcast delivery policy. Defaults to plain delivery, which is what every event
/// needs unless it is superseded by its successor.
/// </summary>
public readonly record struct EventDeliveryOptions
{
    /// <summary>
    /// When set, a queued payload with the same key is replaced by this one rather than both
    /// being delivered, and coalescable payloads are dropped in preference to disconnecting a
    /// client whose queue is full. Only use this where the newer payload fully supersedes the
    /// older one, since the replaced payload is never sent and its caller is completed as
    /// though it had been.
    /// </summary>
    public string? CoalesceKey { get; init; }
}
