namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool IsBrmbleClient = false, string? CertHash = null);

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
    /// a client can detect a gap (revision > last + 1) and request a snapshot.
    /// </summary>
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
    bool TryUpdateBrmbleStatus(int sessionId, bool isBrmbleClient);
    bool TryUpdateCertHash(int sessionId, string certHash);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
