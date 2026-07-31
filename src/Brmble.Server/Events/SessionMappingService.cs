using System.Collections.Concurrent;

namespace Brmble.Server.Events;

public class SessionMappingService : ISessionMappingService
{
    private readonly ConcurrentDictionary<int, SessionMapping> _sessionToMapping = new();
    private readonly ConcurrentDictionary<string, int> _nameToSession = new();
    private readonly ConcurrentDictionary<int, string> _sessionToName = new();
    private readonly ConcurrentDictionary<long, int> _userIdToSession = new();

    private readonly string _instanceId = Guid.NewGuid().ToString("N");
    private long _revision;

    public string InstanceId => _instanceId;

    public long Revision => Interlocked.Read(ref _revision);

    private void Bump() => Interlocked.Increment(ref _revision);

    public void SetNameForSession(string name, int sessionId)
    {
        _nameToSession[name] = sessionId;
        _sessionToName[sessionId] = name;
    }

    public bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId)
    {
        if (_sessionToMapping.TryAdd(sessionId, new SessionMapping(matrixUserId, mumbleName, userId, companionId)))
        {
            _userIdToSession[userId] = sessionId;
            Bump();
            return true;
        }

        _userIdToSession[userId] = sessionId;
        return false;
    }

    public void RemoveSession(int sessionId)
    {
        var changed = false;
        if (_sessionToMapping.TryRemove(sessionId, out var mapping))
        {
            // Only remove userId→session if it still points to this session
            ((ICollection<KeyValuePair<long, int>>)_userIdToSession)
                .Remove(new KeyValuePair<long, int>(mapping.UserId, sessionId));
            changed = true;
        }
        if (_sessionToName.TryRemove(sessionId, out var name))
        {
            // Only remove name→session if it still points to this session
            // (a newer session may have claimed the same name)
            ((ICollection<KeyValuePair<string, int>>)_nameToSession)
                .Remove(new KeyValuePair<string, int>(name, sessionId));
        }
        if (changed) Bump();
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

    public bool TryGetSessionByUserId(long userId, out int sessionId)
    {
        return _userIdToSession.TryGetValue(userId, out sessionId);
    }

    public bool TryGetMappingByUserId(long userId, out int sessionId, out SessionMapping? mapping)
    {
        if (_userIdToSession.TryGetValue(userId, out sessionId) &&
            _sessionToMapping.TryGetValue(sessionId, out mapping) &&
            mapping.UserId == userId)
        {
            return true;
        }

        sessionId = 0;
        mapping = null;
        return false;
    }

    public bool TryUpdateBrmbleStatus(int sessionId, bool? isBrmbleClient)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            var updated = existing with { IsBrmbleClient = isBrmbleClient };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }

    public bool TryUpdateCompanionId(int sessionId, string companionId)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            var updated = existing with { CompanionId = companionId };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }

    public bool TryUpdateCompanionIdIfCurrent(int sessionId, string expectedCompanionId, string companionId)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            if (!string.Equals(existing.CompanionId, expectedCompanionId, StringComparison.Ordinal))
                return false;

            var updated = existing with { CompanionId = companionId };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }

    public bool TryUpdateCompanionIdIfOwnedBy(int sessionId, long userId, string companionId)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            // Compare-and-swap on the mapping we read: a session removed and recycled to a
            // different user between the read and the write would otherwise have its owner's
            // companion overwritten, and the change announced under the wrong identity.
            if (existing.UserId != userId)
                return false;

            var updated = existing with { CompanionId = companionId };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }

    public bool TryUpdateCertHash(int sessionId, string certHash)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            var updated = existing with { CertHash = certHash };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }

    public IReadOnlyDictionary<int, SessionMapping> GetSnapshot()
    {
        return new Dictionary<int, SessionMapping>(_sessionToMapping);
    }
}
