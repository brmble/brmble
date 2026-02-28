using System.Collections.Concurrent;

namespace Brmble.Server.Events;

public class SessionMappingService : ISessionMappingService
{
    private readonly ConcurrentDictionary<int, SessionMapping> _sessionToMapping = new();
    private readonly ConcurrentDictionary<string, int> _nameToSession = new();
    private readonly ConcurrentDictionary<int, string> _sessionToName = new();

    public void SetNameForSession(string name, int sessionId)
    {
        _nameToSession[name] = sessionId;
        _sessionToName[sessionId] = name;
    }

    public bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName)
    {
        return _sessionToMapping.TryAdd(sessionId, new SessionMapping(matrixUserId, mumbleName));
    }

    public void RemoveSession(int sessionId)
    {
        _sessionToMapping.TryRemove(sessionId, out _);
        if (_sessionToName.TryRemove(sessionId, out var name))
            _nameToSession.TryRemove(name, out _);
    }

    public bool TryGetMatrixUserId(int sessionId, out string? matrixUserId)
    {
        if (_sessionToMapping.TryGetValue(sessionId, out var mapping))
        {
            matrixUserId = mapping.MatrixUserId;
            return true;
        }
        matrixUserId = null;
        return false;
    }

    public bool TryGetSessionId(string mumbleName, out int sessionId)
    {
        return _nameToSession.TryGetValue(mumbleName, out sessionId);
    }

    public IReadOnlyDictionary<int, SessionMapping> GetSnapshot()
    {
        return new Dictionary<int, SessionMapping>(_sessionToMapping);
    }
}
