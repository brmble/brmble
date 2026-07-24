using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintRateLimiterTests
{
    [TestMethod]
    public void TryAcquire_AllowsTwentyPreviewsPerSecondPerUser()
    {
        var limiter = new PaintRateLimiter();
        var now = new DateTimeOffset(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < 20; i++) Assert.IsTrue(limiter.TryAcquire(1, now));
        Assert.IsFalse(limiter.TryAcquire(1, now));
        Assert.IsTrue(limiter.TryAcquire(2, now));
        Assert.IsTrue(limiter.TryAcquire(1, now.AddSeconds(1)));
    }
}
