namespace Brmble.Client.Services.Idle;

/// <summary>
/// Thread-safe holder for the most recent <c>UserStats.idlesecs</c> value per
/// Mumble session. Fed by <c>MumbleAdapter</c>'s UserStats response handler;
/// snapshotted by <see cref="IdleService"/> for the periodic bridge push.
/// </summary>
public sealed class VoiceIdleTracker
{
    private readonly Dictionary<uint, uint> _idleSeconds = new();
    private readonly object _lock = new();

    public void UpdateUserStats(uint session, uint idleSecs)
    {
        lock (_lock)
        {
            _idleSeconds[session] = idleSecs;
        }
    }

    public void RemoveUser(uint session)
    {
        lock (_lock)
        {
            _idleSeconds.Remove(session);
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _idleSeconds.Clear();
        }
    }

    public Dictionary<uint, uint> GetCurrent()
    {
        lock (_lock)
        {
            return new Dictionary<uint, uint>(_idleSeconds);
        }
    }
}
