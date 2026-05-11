using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public sealed record LiveKitParticipantRecord(
    string RoomName,
    string MatrixUserId,
    long UserId,
    int SessionId,
    LiveKitAccessMode AccessMode,
    DateTimeOffset ExpiresAt);

public sealed class LiveKitParticipantTracker
{
    private static readonly TimeSpan MarkerGracePeriod = TimeSpan.FromMinutes(2);
    private readonly object _lock = new();
    private readonly ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> _participants = new();
    private readonly ConcurrentDictionary<int, DateTimeOffset> _revokingSessions = new();
    private readonly ConcurrentDictionary<int, SessionRoomMarker> _sessionRooms = new();

    public void Upsert(LiveKitParticipantRecord record)
        => TryUpsert(record);

    public bool TryUpsert(LiveKitParticipantRecord record, DateTimeOffset? now = null)
    {
        lock (_lock)
        {
            var currentTime = now ?? DateTimeOffset.UtcNow;
            PruneMarkers(currentTime);

            if (_revokingSessions.ContainsKey(record.SessionId))
                return false;

            if (_sessionRooms.TryGetValue(record.SessionId, out var currentRoom)
                && !string.Equals(record.RoomName, currentRoom.RoomName, StringComparison.Ordinal))
            {
                return false;
            }

            _participants[(record.RoomName, record.MatrixUserId)] = record;
            return true;
        }
    }

    public void MarkSessionRevoking(int sessionId, DateTimeOffset? now = null)
    {
        lock (_lock)
        {
            _revokingSessions[sessionId] = (now ?? DateTimeOffset.UtcNow).Add(MarkerGracePeriod);
            _sessionRooms.TryRemove(sessionId, out _);
        }
    }

    public void MarkSessionRoom(int sessionId, string roomName, DateTimeOffset? now = null)
    {
        lock (_lock)
        {
            _sessionRooms[sessionId] = new SessionRoomMarker(roomName, (now ?? DateTimeOffset.UtcNow).Add(MarkerGracePeriod));
        }
    }

    public bool IsSessionRevoking(int sessionId)
    {
        lock (_lock)
        {
            PruneMarkers(DateTimeOffset.UtcNow);
            return _revokingSessions.ContainsKey(sessionId);
        }
    }

    public LiveKitParticipantRecord? Remove(string roomName, string matrixUserId)
    {
        return _participants.TryRemove((roomName, matrixUserId), out var record)
            ? record
            : null;
    }

    public IReadOnlyList<LiveKitParticipantRecord> RemoveBySession(int sessionId)
        => RemoveWhere(record => record.SessionId == sessionId);

    public IReadOnlyList<LiveKitParticipantRecord> RemoveBySessionExceptRoom(int sessionId, string roomName)
        => RemoveWhere(record => record.SessionId == sessionId && !string.Equals(record.RoomName, roomName, StringComparison.Ordinal));

    public IReadOnlyList<LiveKitParticipantRecord> PruneExpired(DateTimeOffset now)
    {
        lock (_lock)
        {
            PruneMarkers(now);
            return RemoveWhereLocked(record => record.ExpiresAt <= now);
        }
    }

    public IReadOnlyList<LiveKitParticipantRecord> GetSnapshot()
    {
        lock (_lock)
        {
            return _participants.Values.ToList();
        }
    }

    private IReadOnlyList<LiveKitParticipantRecord> RemoveWhere(Func<LiveKitParticipantRecord, bool> predicate)
    {
        lock (_lock)
        {
            return RemoveWhereLocked(predicate);
        }
    }

    private IReadOnlyList<LiveKitParticipantRecord> RemoveWhereLocked(Func<LiveKitParticipantRecord, bool> predicate)
    {
        var removed = new List<LiveKitParticipantRecord>();
        foreach (var pair in _participants)
        {
            if (predicate(pair.Value) && TryRemoveMatched(_participants, pair))
            {
                removed.Add(pair.Value);
            }
        }

        return removed;
    }

    private void PruneMarkers(DateTimeOffset now)
    {
        foreach (var pair in _revokingSessions)
        {
            if (pair.Value <= now)
            {
                _revokingSessions.TryRemove(pair.Key, out _);
            }
        }

        foreach (var pair in _sessionRooms)
        {
            if (pair.Value.ExpiresAt <= now)
            {
                _sessionRooms.TryRemove(pair.Key, out _);
            }
        }
    }

    internal static bool TryRemoveMatched(
        ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> participants,
        KeyValuePair<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> participant)
        => ((ICollection<KeyValuePair<(string RoomName, string MatrixUserId), LiveKitParticipantRecord>>)participants).Remove(participant);

    private sealed record SessionRoomMarker(string RoomName, DateTimeOffset ExpiresAt);
}
