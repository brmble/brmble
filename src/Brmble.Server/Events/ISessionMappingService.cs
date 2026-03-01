namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName);

public interface ISessionMappingService
{
    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
