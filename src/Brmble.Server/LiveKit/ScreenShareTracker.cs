using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public class ScreenShareTracker
{
    private readonly ConcurrentDictionary<string, ScreenShareInfo> _shares = new();

    public void Start(string roomName, string userName, long userId)
        => _shares[roomName] = new ScreenShareInfo(userName, userId);

    public void Stop(string roomName)
        => _shares.TryRemove(roomName, out _);

    public ScreenShareInfo? GetActive(string roomName)
        => _shares.TryGetValue(roomName, out var info) ? info : null;

    public string? GetActiveByUserId(long userId)
        => _shares.FirstOrDefault(kvp => kvp.Value.UserId == userId).Key;
}

public record ScreenShareInfo(string UserName, long UserId);
