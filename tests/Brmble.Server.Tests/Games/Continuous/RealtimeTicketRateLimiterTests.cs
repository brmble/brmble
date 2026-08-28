using Brmble.Server.Games.Continuous;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public sealed class RealtimeTicketRateLimiterTests
{
    [TestMethod]
    public void TwoCertificatesResolvedToSameStableUserShareWindow()
    {
        var time = new ManualTimeProvider();
        var limiter = new RealtimeTicketRateLimiter(time);

        for (var request = 0; request < 5; request++) Assert.IsTrue(limiter.TryAcquire(100));
        for (var request = 0; request < 5; request++) Assert.IsTrue(limiter.TryAcquire(100));

        Assert.IsFalse(limiter.TryAcquire(100));
    }

    [TestMethod]
    public void DifferentStableUsersHaveIndependentWindows()
    {
        var time = new ManualTimeProvider();
        var limiter = new RealtimeTicketRateLimiter(time);

        for (var request = 0; request < 10; request++) Assert.IsTrue(limiter.TryAcquire(100));

        Assert.IsFalse(limiter.TryAcquire(100));
        Assert.IsTrue(limiter.TryAcquire(200));
    }

    [TestMethod]
    public void ExactlyTenRequestsAreAcceptedAndEleventhIsRejected()
    {
        var limiter = new RealtimeTicketRateLimiter(new ManualTimeProvider());

        for (var request = 0; request < 10; request++) Assert.IsTrue(limiter.TryAcquire(100));

        Assert.IsFalse(limiter.TryAcquire(100));
    }

    [TestMethod]
    public void WindowResetsAtExactlyOneMinute()
    {
        var time = new ManualTimeProvider();
        var limiter = new RealtimeTicketRateLimiter(time);
        for (var request = 0; request < 10; request++) limiter.TryAcquire(100);
        time.Advance(TimeSpan.FromMilliseconds(59_999));
        Assert.IsFalse(limiter.TryAcquire(100));

        time.Advance(TimeSpan.FromMilliseconds(1));

        Assert.IsTrue(limiter.TryAcquire(100));
    }

    [TestMethod]
    public async Task ConcurrentRequestsAcceptExactlyTen()
    {
        var limiter = new RealtimeTicketRateLimiter(new ManualTimeProvider());

        var results = await Task.WhenAll(Enumerable.Range(0, 40)
            .Select(_ => Task.Run(() => limiter.TryAcquire(100))));

        Assert.AreEqual(10, results.Count(x => x));
    }

    [TestMethod]
    public void CheckRemovesExpiredInactiveUsersAndKeepsActiveAndNewWindows()
    {
        var time = new ManualTimeProvider();
        var limiter = new RealtimeTicketRateLimiter(time);
        Assert.IsTrue(limiter.TryAcquire(100));
        time.Advance(TimeSpan.FromSeconds(30));
        Assert.IsTrue(limiter.TryAcquire(200));
        Assert.AreEqual(2, limiter.Count);

        time.Advance(TimeSpan.FromSeconds(30));
        Assert.IsTrue(limiter.TryAcquire(300));

        Assert.AreEqual(2, limiter.Count);
        Assert.IsTrue(limiter.TryAcquire(200));
        Assert.AreEqual(2, limiter.Count);
    }

    [TestMethod]
    public void ExpiredCurrentUserResetsWithoutRetainingOldWindow()
    {
        var time = new ManualTimeProvider();
        var limiter = new RealtimeTicketRateLimiter(time);
        for (var request = 0; request < 10; request++) Assert.IsTrue(limiter.TryAcquire(100));
        time.Advance(TimeSpan.FromMinutes(1));

        Assert.IsTrue(limiter.TryAcquire(100));

        Assert.AreEqual(1, limiter.Count);
        for (var request = 1; request < 10; request++) Assert.IsTrue(limiter.TryAcquire(100));
        Assert.IsFalse(limiter.TryAcquire(100));
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
