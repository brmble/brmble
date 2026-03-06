using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public class ScreenShareTracker
{
    private readonly ConcurrentDictionary<string, ScreenShareInfo> _shares = new();

    public void Start(string roomName, string userName, string matrixUserId)
        => _shares[roomName] = new ScreenShareInfo(userName, matrixUserId);

    public void Stop(string roomName)
        => _shares.TryRemove(roomName, out _);

    public ScreenShareInfo? GetActive(string roomName)
        => _shares.TryGetValue(roomName, out var info) ? info : null;
}

public record ScreenShareInfo(string UserName, string MatrixUserId);
