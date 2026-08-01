namespace Brmble.Server.Events;

/// <summary>
/// Stamped on every session-mapping payload so a client can tell a restart from a gap.
/// </summary>
/// <param name="InstanceId">Identifies the server's mapping table; changes on restart.</param>
/// <param name="Revision">The table revision produced by the mutation being announced.</param>
public readonly record struct MappingEnvelope(string InstanceId, long Revision);
