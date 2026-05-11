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
    private readonly object _lock = new();
    private readonly ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> _participants = new();
    private readonly ConcurrentDictionary<int, byte> _revokingSessions = new();
    private readonly ConcurrentDictionary<int, string> _sessionRooms = new();

    public void Upsert(LiveKitParticipantRecord record)
        => TryUpsert(record);

    public bool TryUpsert(LiveKitParticipantRecord record)
    {
        lock (_lock)
        {
            if (_revokingSessions.ContainsKey(record.SessionId))
                return false;

            if (_sessionRooms.TryGetValue(record.SessionId, out var currentRoom)
                && !string.Equals(record.RoomName, currentRoom, StringComparison.Ordinal))
            {
                return false;
            }

            _participants[(record.RoomName, record.MatrixUserId)] = record;
            return true;
        }
    }

    public void MarkSessionRevoking(int sessionId)
    {
        lock (_lock)
        {
            _revokingSessions[sessionId] = 0;
        }
    }

    public void MarkSessionRoom(int sessionId, string roomName)
    {
        lock (_lock)
        {
            _sessionRooms[sessionId] = roomName;
        }
    }

    public bool IsSessionRevoking(int sessionId)
    {
        lock (_lock)
        {
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
        => RemoveWhere(record => record.ExpiresAt <= now);

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
    }

    internal static bool TryRemoveMatched(
        ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> participants,
        KeyValuePair<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> participant)
        => ((ICollection<KeyValuePair<(string RoomName, string MatrixUserId), LiveKitParticipantRecord>>)participants).Remove(participant);
}
