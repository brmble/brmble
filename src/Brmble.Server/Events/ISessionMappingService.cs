namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool IsBrmbleClient = false, string? CertHash = null);

public interface ISessionMappingService
{
    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    bool TryGetSessionByUserId(long userId, out int sessionId);
    bool TryGetMappingByUserId(long userId, out int sessionId, out SessionMapping? mapping);
    bool TryUpdateCompanionId(int sessionId, string companionId);
    bool TryUpdateBrmbleStatus(int sessionId, bool isBrmbleClient);
    bool TryUpdateCertHash(int sessionId, string certHash);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
