namespace Brmble.Server.Games.Continuous;

public sealed class RealtimeTicketRateLimiter(TimeProvider time)
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private const int PermitLimit = 10;
    private readonly object _sync = new();
    private readonly Dictionary<long, WindowState> _windows = [];

    internal int Count
    {
        get { lock (_sync) return _windows.Count; }
    }

    public bool TryAcquire(long stableUserId)
    {
        lock (_sync)
        {
            var now = time.GetUtcNow();
            foreach (var expiredUserId in _windows
                .Where(x => now - x.Value.StartedAt >= Window)
                .Select(x => x.Key)
                .ToArray())
                _windows.Remove(expiredUserId);
            if (!_windows.TryGetValue(stableUserId, out var state)
                || now - state.StartedAt >= Window)
            {
                _windows[stableUserId] = new WindowState(now, 1);
                return true;
            }
            if (state.Count >= PermitLimit) return false;
            _windows[stableUserId] = state with { Count = state.Count + 1 };
            return true;
        }
    }

    private sealed record WindowState(DateTimeOffset StartedAt, int Count);
}
