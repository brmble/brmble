namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool? IsBrmbleClient = null, string? CertHash = null);

public interface ISessionMappingService
{
    /// <summary>
    /// Identifies this process's mapping table. Regenerated on every start, so a client that
    /// sees a different value knows the server restarted and its cached server-owned fields
    /// are worthless.
    /// </summary>
    string InstanceId { get; }

    /// <summary>
    /// Monotonic counter, incremented once per successful mutation. Stamped on every payload so
    /// a client can order and deduplicate events.
    /// </summary>
    /// <remarks>
    /// One logical operation may increment this several times — a first registration does add,
    /// certHash and brmbleStatus under a single announcement, moving it by three — so
    /// <c>revision == last + 1</c> is <b>not</b> a valid gap test. Phase 2 stamps the range's
    /// start alongside it (<c>baseRevision</c>) precisely so a client can distinguish a
    /// multi-bump operation from a genuine gap.
    /// </remarks>
    long Revision { get; }

    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    bool TryGetSessionByUserId(long userId, out int sessionId);
    bool TryGetMappingByUserId(long userId, out int sessionId, out SessionMapping? mapping);
    bool TryUpdateCompanionId(int sessionId, string companionId);
    bool TryUpdateCompanionIdIfCurrent(int sessionId, string expectedCompanionId, string companionId);
    bool TryUpdateCompanionIdIfOwnedBy(int sessionId, long userId, string companionId);
    bool TryUpdateBrmbleStatus(int sessionId, bool? isBrmbleClient);
    bool TryUpdateCertHash(int sessionId, string certHash);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
