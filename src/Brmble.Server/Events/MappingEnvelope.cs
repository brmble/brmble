namespace Brmble.Server.Events;

/// <summary>
/// Stamped on every session-mapping payload so a client can tell a restart from a gap.
/// </summary>
/// <param name="InstanceId">Identifies the server's mapping table; changes on restart.</param>
/// <param name="Revision">The table revision after the mutation being announced.</param>
/// <param name="BaseRevision">
/// The table revision before it. One logical operation may bump the counter several times, so a
/// client applies on <c>BaseRevision == ours</c> rather than on <c>Revision == ours + 1</c>.
/// </param>
public readonly record struct MappingEnvelope(string InstanceId, long Revision, long BaseRevision)
{
    /// <summary>
    /// A snapshot is absolute rather than a delta — it sets the client's cursor outright — so it
    /// is its own base.
    /// </summary>
    public static MappingEnvelope Snapshot(string instanceId, long revision) =>
        new(instanceId, revision, revision);
}
