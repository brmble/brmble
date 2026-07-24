namespace Brmble.Server.Paint;

public sealed class PaintRateLimiter
{
    private const int PreviewLimit = 20;
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(1);
    private readonly Dictionary<long, Queue<DateTimeOffset>> _requests = [];
    private readonly object _lock = new();

    public bool TryAcquire(long userId, DateTimeOffset now)
    {
        lock (_lock)
        {
            if (!_requests.TryGetValue(userId, out var requests))
                _requests[userId] = requests = new Queue<DateTimeOffset>();

            while (requests.TryPeek(out var first) && first <= now - Window)
                requests.Dequeue();
            if (requests.Count >= PreviewLimit) return false;
            requests.Enqueue(now);
            return true;
        }
    }
}
