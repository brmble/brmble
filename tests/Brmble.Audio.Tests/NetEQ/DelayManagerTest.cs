using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.NetEQ;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class DelayManagerTest
{
    private const int SampleRate = 48000;
    private const int FrameSize = 960;

    [TestMethod]
    public void InitialTargetLevel_IsMinimum()
    {
        var dm = new DelayManager();
        Assert.AreEqual(1, dm.TargetLevel);
    }

    [TestMethod]
    public void Update_LowJitter_TargetStaysLow()
    {
        var dm = new DelayManager();
        for (int i = 0; i < 50; i++)
            dm.Update(i * FrameSize, i * 20);
        Assert.AreEqual(1, dm.TargetLevel);
    }

    [TestMethod]
    public void Update_HighJitter_TargetIncreases()
    {
        var dm = new DelayManager();
        var rng = new Random(42);
        for (int i = 0; i < 100; i++)
            dm.Update(i * FrameSize, i * 20 + rng.Next(0, 80));
        Assert.IsTrue(dm.TargetLevel > 1, $"Expected target > 1, got {dm.TargetLevel}");
    }

    [TestMethod]
    public void Update_JitterReduces_TargetShrinks()
    {
        var dm = new DelayManager();
        var rng = new Random(42);
        for (int i = 0; i < 100; i++)
            dm.Update(i * FrameSize, i * 20 + rng.Next(0, 100));
        int highTarget = dm.TargetLevel;
        for (int i = 100; i < 300; i++)
            dm.Update(i * FrameSize, i * 20 + rng.Next(0, 5));
        Assert.IsTrue(dm.TargetLevel < highTarget, $"Expected target to shrink from {highTarget}, got {dm.TargetLevel}");
    }

    [TestMethod]
    public void TargetLevel_NeverExceedsMax()
    {
        var dm = new DelayManager(maxLevel: 15);
        for (int i = 0; i < 100; i++)
            dm.Update(i * FrameSize, i * 20 + i * 50);
        Assert.IsTrue(dm.TargetLevel <= 15);
    }

    [TestMethod]
    public void TargetLevel_NeverBelowMin()
    {
        var dm = new DelayManager(minLevel: 1);
        for (int i = 0; i < 100; i++)
            dm.Update(i * FrameSize, i * 20);
        Assert.IsTrue(dm.TargetLevel >= 1);
    }

    [TestMethod]
    public void Reset_ClearsHistoryAndTarget()
    {
        var dm = new DelayManager();
        for (int i = 0; i < 50; i++)
            dm.Update(i * FrameSize, i * 20 + i * 10);
        dm.Reset();
        Assert.AreEqual(1, dm.TargetLevel);
    }
}
