namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, bool IsBrmbleClient = false);

public interface ISessionMappingService
{
    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    bool TryGetSessionByUserId(long userId, out int sessionId);
    bool TryUpdateBrmbleStatus(int sessionId, bool isBrmbleClient);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
