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
}
