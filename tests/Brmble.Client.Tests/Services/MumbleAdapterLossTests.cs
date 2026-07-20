using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterLossTests
{
    private uint _good, _late, _lost;
    private bool _hasBase;

    private int? Update(uint good, uint late, uint lost) =>
        MumbleAdapter.ComputeOutboundLossPercent(good, late, lost,
            ref _good, ref _late, ref _lost, ref _hasBase);

    [TestMethod]
    public void FirstSample_OnlyBaselines()
    {
        Assert.IsNull(Update(100, 0, 10));
    }

    [TestMethod]
    public void Delta_ComputesLossPercent()
    {
        Update(100, 0, 0);
        // 90 good + 10 lost since last ping → 10%
        Assert.AreEqual(10, Update(190, 0, 10));
    }

    [TestMethod]
    public void NoTraffic_ReturnsNull()
    {
        Update(100, 0, 5);
        Assert.IsNull(Update(100, 0, 5), "No packets since last ping must not report loss");
    }

    [TestMethod]
    public void CounterRegression_Rebaselines()
    {
        Update(100, 0, 5);
        // Server restart / reconnect: counters drop → re-baseline, no bogus loss
        Assert.IsNull(Update(10, 0, 0));
        // Next delta computed from the new baseline
        Assert.AreEqual(0, Update(110, 0, 0));
    }

    [TestMethod]
    public void LateCountsAsDelivered()
    {
        Update(0, 0, 0);
        // 50 good + 30 late + 20 lost → 20% loss
        Assert.AreEqual(20, Update(50, 30, 20));
    }
}
