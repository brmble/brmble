using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public class ScreenShareTracker
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<long, ScreenShareInfo>> _shares = new();

    public bool Start(string roomName, string userName, long userId, string? matrixUserId = null)
    {
        var room = _shares.GetOrAdd(roomName, _ => new ConcurrentDictionary<long, ScreenShareInfo>());
        return room.TryAdd(userId, new ScreenShareInfo(userName, userId, matrixUserId));
    }

    public bool StartOrRefresh(string roomName, string userName, long userId, string? matrixUserId = null)
    {
        var room = _shares.GetOrAdd(roomName, _ => new ConcurrentDictionary<long, ScreenShareInfo>());
        room[userId] = new ScreenShareInfo(userName, userId, matrixUserId);
        return true;
    }

    public void Stop(string roomName)
        => _shares.TryRemove(roomName, out _);

    public void StopByUserId(string roomName, long userId)
    {
        if (_shares.TryGetValue(roomName, out var room) && room.TryRemove(userId, out _))
        {
            if (room.IsEmpty)
                _shares.TryRemove(roomName, out _);
        }
    }

    public IReadOnlyList<string> StopAllByUserId(long userId)
    {
        var stoppedRooms = new List<string>();
        foreach (var kvp in _shares)
        {
            if (kvp.Value.TryRemove(userId, out _))
            {
                stoppedRooms.Add(kvp.Key);
                if (kvp.Value.IsEmpty)
                    _shares.TryRemove(kvp.Key, out _);
            }
        }
        return stoppedRooms;
    }

    public List<ScreenShareInfo> GetActiveShares(string roomName)
        => _shares.TryGetValue(roomName, out var room) ? room.Values.ToList() : [];

    public ScreenShareInfo? GetActive(string roomName)
        => _shares.TryGetValue(roomName, out var room) ? room.Values.FirstOrDefault() : null;

    public string? GetActiveByUserId(long userId)
        => _shares.FirstOrDefault(kvp => kvp.Value.ContainsKey(userId)) is { Key: not null } match ? match.Key : null;

    public List<string> GetSharesByUserId(long userId)
        => _shares.Where(kvp => kvp.Value.ContainsKey(userId)).Select(kvp => kvp.Key).ToList();

    public List<string> GetAllRoomNames()
        => _shares.Keys.ToList();
}

public record ScreenShareInfo(string UserName, long UserId, string? MatrixUserId = null);
