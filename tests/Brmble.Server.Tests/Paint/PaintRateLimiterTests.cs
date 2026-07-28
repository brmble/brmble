using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintRateLimiterTests
{
    [TestMethod]
    public void TryAcquire_AllowsTwentyPreviewsPerSecondPerAuthorPerSession()
    {
        var limiter = new PaintRateLimiter();
        var now = new DateTimeOffset(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);
        var firstSessionId = Guid.NewGuid();
        var secondSessionId = Guid.NewGuid();

        for (var i = 0; i < 20; i++) Assert.IsTrue(limiter.TryAcquire(firstSessionId, 1, now));
        Assert.IsFalse(limiter.TryAcquire(firstSessionId, 1, now));
        Assert.IsTrue(limiter.TryAcquire(firstSessionId, 2, now));
        Assert.IsTrue(limiter.TryAcquire(secondSessionId, 1, now));
        Assert.IsTrue(limiter.TryAcquire(firstSessionId, 1, now.AddSeconds(1)));
    }

    [TestMethod]
    public void EvictSession_DropsWindowsForThatSessionOnly()
    {
        // The limiter is a singleton and keyed by (session, user), so without eviction every
        // participant of every session that has ever run leaks an entry for the process lifetime.
        var limiter = new PaintRateLimiter();
        var now = new DateTimeOffset(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);
        var evictedSessionId = Guid.NewGuid();
        var retainedSessionId = Guid.NewGuid();

        for (var i = 0; i < 20; i++) Assert.IsTrue(limiter.TryAcquire(evictedSessionId, 1, now));
        for (var i = 0; i < 20; i++) Assert.IsTrue(limiter.TryAcquireCommit(evictedSessionId, 1, now));
        for (var i = 0; i < 20; i++) Assert.IsTrue(limiter.TryAcquire(retainedSessionId, 1, now));
        Assert.IsFalse(limiter.TryAcquire(evictedSessionId, 1, now));
        Assert.IsFalse(limiter.TryAcquireCommit(evictedSessionId, 1, now));
        Assert.IsFalse(limiter.TryAcquire(retainedSessionId, 1, now));

        limiter.EvictSession(evictedSessionId);

        Assert.IsTrue(limiter.TryAcquire(evictedSessionId, 1, now), "preview window should have been dropped");
        Assert.IsTrue(limiter.TryAcquireCommit(evictedSessionId, 1, now), "commit window should have been dropped");
        Assert.IsFalse(limiter.TryAcquire(retainedSessionId, 1, now), "an unrelated session must keep its window");
    }
}
