using Brmble.Server.Games.Continuous;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class FixedStepSchedulerTests
{
    [TestMethod]
    public void RationalPeriod_ProducesExactlySixtyDeadlinesPerSecond()
    {
        var sut = new FixedStepScheduler(new ManualTimestampClock(10_000_000), 60, 5);
        sut.Start(0);

        CollectionAssert.AreEqual(
            new long[] { 166_666, 333_333, 500_000, 666_666, 833_333, 1_000_000 },
            Enumerable.Range(0, 6).Select(_ => sut.AdvanceDeadline()).ToArray());
        for (var i = 6; i < 60; i++)
            sut.AdvanceDeadline();

        Assert.AreEqual(10_000_000L, sut.NextDeadline);
    }

    [TestMethod]
    public void DelayedCycle_RunsAtMostFiveTicksAndResynchronizesDeadline()
    {
        var clock = new ManualTimestampClock(frequency: 60_000);
        var sut = new FixedStepScheduler(clock, tickRate: 60, maxCatchUpTicks: 5);
        sut.Start(clock.Timestamp);
        clock.AdvanceMilliseconds(200);

        var cycle = sut.PlanCycle();

        Assert.AreEqual(5, cycle.Ticks);
        Assert.IsTrue(cycle.Overloaded);
        Assert.AreEqual(clock.Timestamp + 1_000L, cycle.NextDeadline);
    }

    [TestMethod]
    public void NormalCatchUp_AdvancesPriorDeadlineAndPreservesRationalCarry()
    {
        var clock = new ManualTimestampClock(frequency: 10);
        var sut = new FixedStepScheduler(clock, tickRate: 6, maxCatchUpTicks: 5);
        sut.Start(0);
        sut.AdvanceDeadline();
        clock.AdvanceTimestamp(5);

        var cycle = sut.PlanCycle();

        Assert.AreEqual(3, cycle.Ticks);
        Assert.IsFalse(cycle.Overloaded);
        Assert.AreEqual(6L, cycle.NextDeadline);
    }

    [TestMethod]
    public void CycleAtDeadline_PlansOneTickAndAdvancesToFollowingDeadline()
    {
        var clock = new ManualTimestampClock(frequency: 60_000);
        var sut = new FixedStepScheduler(clock, tickRate: 60, maxCatchUpTicks: 5);
        sut.Start(0);
        clock.AdvanceTimestamp(sut.AdvanceDeadline());

        var cycle = sut.PlanCycle();

        Assert.AreEqual(1, cycle.Ticks);
        Assert.IsFalse(cycle.Overloaded);
        Assert.AreEqual(2_000L, cycle.NextDeadline);
    }

    private sealed class ManualTimestampClock(long frequency) : TimeProvider
    {
        public long Timestamp { get; private set; }
        public override long TimestampFrequency => frequency;
        public override long GetTimestamp() => Timestamp;

        public void AdvanceMilliseconds(long milliseconds) =>
            Timestamp += milliseconds * TimestampFrequency / 1_000;

        public void AdvanceTimestamp(long timestamp) => Timestamp = timestamp;
    }
}
