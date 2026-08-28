namespace Brmble.Server.Games.Continuous;

public sealed class RealtimeTicketRateLimiter(TimeProvider time)
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private const int PermitLimit = 10;
    private readonly object _sync = new();
    private readonly Dictionary<long, WindowState> _windows = [];

    public bool TryAcquire(long stableUserId)
    {
        lock (_sync)
        {
            var now = time.GetUtcNow();
            if (!_windows.TryGetValue(stableUserId, out var state)
                || now >= state.StartedAt.Add(Window))
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
