using Microsoft.VisualStudio.TestTools.UnitTesting;
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class DecisionLogicTest
{
    [TestMethod]
    public void PacketAvailable_BufferAtTarget_ReturnsNormal()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 3,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);
        Assert.AreEqual(PlayoutDecision.Normal, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferAboveTarget_ReturnsAccelerate()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 6,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);
        Assert.AreEqual(PlayoutDecision.Accelerate, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferBelowTarget_ReturnsDecelerate()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 0,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);
        Assert.AreEqual(PlayoutDecision.Decelerate, decision);
    }

    [TestMethod]
    public void NoPacket_ReturnsExpand()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: false,
            bufferLevel: 0,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);
        Assert.AreEqual(PlayoutDecision.Expand, decision);
    }

    [TestMethod]
    public void PacketAvailable_AfterExpand_ReturnsMerge()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 3,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Expand);
        Assert.AreEqual(PlayoutDecision.Merge, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferSlightlyAboveTarget_ReturnsNormal()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 4,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);
        Assert.AreEqual(PlayoutDecision.Normal, decision);
    }
}
