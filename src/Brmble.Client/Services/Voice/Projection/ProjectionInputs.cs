namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// A Mumble <c>UserState</c>, reduced to the fields Mumble owns. Complete every time: Mumble
/// resends the full state on every change, so these values are authoritative even when empty.
/// </summary>
internal sealed record MumbleUserInput(
    uint SessionId,
    string? Name,
    uint ChannelId,
    bool Muted,
    bool Deafened,
    string? Comment,
    string? CertHash,
    bool IsSelf);

/// <summary>
/// The server-owned half of one session. Every field is nullable and <c>null</c> means "not
/// known", never "cleared".
/// </summary>
internal sealed record ServerMappingEntry(
    string? MatrixUserId,
    string? CompanionId,
    bool? IsBrmbleClient,
    string? CertHash);

/// <summary>
/// A complete statement of every session the server knows about, from <c>/auth/token</c> or a
/// WebSocket <c>sessionMappingSnapshot</c>. Authoritative for membership: a session absent from
/// it has its server-owned fields reset to unknown (spec §4.3).
/// </summary>
internal sealed record ServerSnapshot(
    string InstanceId,
    long Revision,
    IReadOnlyDictionary<uint, ServerMappingEntry> Mappings);

internal enum ServerEventKind
{
    MappingAdded,
    MappingRemoved,
    CompanionChanged,
    BrmbleActivated,
    BrmbleDeactivated
}

/// <summary>
/// One incremental server event.
/// </summary>
/// <param name="BaseRevision">
/// The revision this event applies on top of. The client applies when this equals its own
/// cursor — see the table in the Phase 2 plan. Not <c>Revision - 1</c>: one operation may bump
/// the server's counter several times.
/// </param>
internal sealed record ServerEvent(
    ServerEventKind Kind,
    string InstanceId,
    long BaseRevision,
    long Revision,
    uint SessionId,
    ServerMappingEntry? Entry = null);
