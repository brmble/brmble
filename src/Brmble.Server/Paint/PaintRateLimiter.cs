namespace Brmble.Server.Paint;

public sealed class PaintRateLimiter
{
    private const int PreviewLimit = 20;
    private const int CommitLimit = 20;
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(1);
    private readonly Dictionary<(Guid SessionId, long UserId), Queue<DateTimeOffset>> _previewRequests = [];
    private readonly Dictionary<(Guid SessionId, long UserId), Queue<DateTimeOffset>> _commitRequests = [];
    private readonly object _lock = new();

    public bool TryAcquire(Guid sessionId, long userId, DateTimeOffset now)
        => TryAcquire(_previewRequests, PreviewLimit, sessionId, userId, now);

    public bool TryAcquireCommit(Guid sessionId, long userId, DateTimeOffset now)
        => TryAcquire(_commitRequests, CommitLimit, sessionId, userId, now);

    private bool TryAcquire(Dictionary<(Guid SessionId, long UserId), Queue<DateTimeOffset>> requestsByUser, int limit,
        Guid sessionId, long userId, DateTimeOffset now)
    {
        lock (_lock)
        {
            var key = (sessionId, userId);
            if (!requestsByUser.TryGetValue(key, out var requests))
                requestsByUser[key] = requests = new Queue<DateTimeOffset>();

            while (requests.TryPeek(out var first) && first <= now - Window)
                requests.Dequeue();
            if (requests.Count >= limit) return false;
            requests.Enqueue(now);
            return true;
        }
    }
}
