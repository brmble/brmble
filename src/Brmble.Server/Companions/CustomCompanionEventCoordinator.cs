namespace Brmble.Server.Companions;

using System.Collections.Concurrent;

public sealed class CustomCompanionEventCoordinator
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _eventLocks =
        new(StringComparer.Ordinal);

    public async Task<IDisposable> AcquireAsync(
        string eventId,
        CancellationToken cancellationToken = default)
    {
        var eventLock = _eventLocks.GetOrAdd(eventId, _ => new SemaphoreSlim(1, 1));
        await eventLock.WaitAsync(cancellationToken);
        return new Releaser(eventLock);
    }

    private sealed class Releaser(SemaphoreSlim eventLock) : IDisposable
    {
        private SemaphoreSlim? _eventLock = eventLock;

        public void Dispose() => Interlocked.Exchange(ref _eventLock, null)?.Release();
    }
}
