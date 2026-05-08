using Brmble.Client.Services.Idle;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Idle;

[TestClass]
public class PollBatchPlannerTests
{
    [TestMethod]
    public void Plan_EmptySessions_ReturnsEmpty()
    {
        var plan = PollBatchPlanner.Plan(offset: 0, sessionCount: 0, batchSize: 4);
        Assert.AreEqual(0, plan.IndicesToPoll.Length);
        Assert.AreEqual(0, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_SmallChannel_PicksAllUsersInOneTick()
    {
        var plan = PollBatchPlanner.Plan(offset: 0, sessionCount: 3, batchSize: 4);
        CollectionAssert.AreEqual(new[] { 0, 1, 2 }, plan.IndicesToPoll);
        Assert.AreEqual(0, plan.NewOffset, "small channel: offset wraps back to 0");
    }

    [TestMethod]
    public void Plan_FirstTickOfLargeChannel_PicksFirstBatch()
    {
        var plan = PollBatchPlanner.Plan(offset: 0, sessionCount: 30, batchSize: 4);
        CollectionAssert.AreEqual(new[] { 0, 1, 2, 3 }, plan.IndicesToPoll);
        Assert.AreEqual(4, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_MidSweep_PicksContinuationBatch()
    {
        var plan = PollBatchPlanner.Plan(offset: 12, sessionCount: 30, batchSize: 4);
        CollectionAssert.AreEqual(new[] { 12, 13, 14, 15 }, plan.IndicesToPoll);
        Assert.AreEqual(16, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_BatchWrapsAroundEnd_ContinuesFromZero()
    {
        var plan = PollBatchPlanner.Plan(offset: 28, sessionCount: 30, batchSize: 4);
        CollectionAssert.AreEqual(new[] { 28, 29, 0, 1 }, plan.IndicesToPoll);
        Assert.AreEqual(2, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_FullSweep_VisitsEveryIndexExactlyOnce()
    {
        // 30 users / 4 per batch ⇒ 8 ticks (last tick wraps + revisits some)
        const int total = 30;
        const int batch = 4;
        int offset = 0;
        var visited = new System.Collections.Generic.HashSet<int>();
        for (int tick = 0; tick < (total + batch - 1) / batch; tick++)
        {
            var plan = PollBatchPlanner.Plan(offset, total, batch);
            foreach (var i in plan.IndicesToPoll) visited.Add(i);
            offset = plan.NewOffset;
        }
        Assert.AreEqual(total, visited.Count, "every session must be polled within one sweep");
    }

    [TestMethod]
    public void Plan_OffsetGreaterThanSessionCount_NormalisesViaModulo()
    {
        var plan = PollBatchPlanner.Plan(offset: 73, sessionCount: 10, batchSize: 4);
        // 73 % 10 = 3, so we expect indices {3,4,5,6}
        CollectionAssert.AreEqual(new[] { 3, 4, 5, 6 }, plan.IndicesToPoll);
        Assert.AreEqual(7, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_NegativeOffset_NormalisesSafely()
    {
        var plan = PollBatchPlanner.Plan(offset: -1, sessionCount: 10, batchSize: 4);
        // -1 → 9 (mod 10), so indices {9, 0, 1, 2}
        CollectionAssert.AreEqual(new[] { 9, 0, 1, 2 }, plan.IndicesToPoll);
        Assert.AreEqual(3, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_BatchSizeZero_ReturnsEmpty()
    {
        var plan = PollBatchPlanner.Plan(offset: 0, sessionCount: 10, batchSize: 0);
        Assert.AreEqual(0, plan.IndicesToPoll.Length);
        Assert.AreEqual(0, plan.NewOffset);
    }

    [TestMethod]
    public void Plan_BatchSizeOne_AdvancesByOnePerTick()
    {
        var plan1 = PollBatchPlanner.Plan(offset: 0, sessionCount: 3, batchSize: 1);
        CollectionAssert.AreEqual(new[] { 0 }, plan1.IndicesToPoll);
        Assert.AreEqual(1, plan1.NewOffset);

        var plan2 = PollBatchPlanner.Plan(offset: plan1.NewOffset, sessionCount: 3, batchSize: 1);
        CollectionAssert.AreEqual(new[] { 1 }, plan2.IndicesToPoll);
        Assert.AreEqual(2, plan2.NewOffset);

        var plan3 = PollBatchPlanner.Plan(offset: plan2.NewOffset, sessionCount: 3, batchSize: 1);
        CollectionAssert.AreEqual(new[] { 2 }, plan3.IndicesToPoll);
        Assert.AreEqual(0, plan3.NewOffset);
    }
}
