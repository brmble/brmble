using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class FixedPointTests
{
    [DataTestMethod]
    [DataRow(32767, 0, 32767, 0)]
    [DataRow(32767, 32767, 23170, 23170)]
    [DataRow(-32767, 32767, -23170, 23170)]
    [DataRow(0, 0, 0, 0)]
    public void NormalizeQ15_IsDeterministic(int x, int y, int expectedX, int expectedY) =>
        Assert.AreEqual(new FixedVec(expectedX, expectedY), FixedVec.NormalizeQ15(x, y));

    [TestMethod]
    public void ChargeCurves_ClampAtEndpointsAndMatchGoldenVectors()
    {
        Assert.AreEqual(90, ArenaRulesetV1.MovePerTick(0));
        Assert.AreEqual(45, ArenaRulesetV1.MovePerTick(1000));
        Assert.AreEqual(45, ArenaRulesetV1.MovePerTick(5000));
        Assert.AreEqual(90, ArenaRulesetV1.MovePerTick(-1));
        Assert.AreEqual(350, ArenaRulesetV1.Knockback(1000));
        Assert.AreEqual(150, ArenaRulesetV1.Recoil(1000));
        Assert.AreEqual(76, ArenaRulesetV1.MovePerTick(333));
        Assert.AreEqual(203, ArenaRulesetV1.Knockback(333));
        Assert.AreEqual(79, ArenaRulesetV1.Recoil(333));
    }

    [DataTestMethod]
    [DataRow(599, 9000)]
    [DataRow(600, 8997)]
    [DataRow(2399, 3500)]
    [DataRow(2400, 3498)]
    [DataRow(3599, 0)]
    [DataRow(3600, 0)]
    public void ArenaRadius_UsesExactInclusiveBoundaries(int tick, int radius) =>
        Assert.AreEqual(radius, ArenaRulesetV1.ArenaRadius(tick));

    [TestMethod]
    public void Damping_TruncatesTowardZeroOnBothSigns()
    {
        Assert.AreEqual(322, 350 * 920 / 1000);
        Assert.AreEqual(-138, -151 * 920 / 1000);
    }

    [TestMethod]
    public void NormalizeQ15_RejectsOverflowingInput() =>
        Assert.ThrowsException<OverflowException>(() =>
            FixedVec.NormalizeQ15(int.MaxValue, int.MaxValue).Scale(int.MaxValue));

    [TestMethod]
    public void DeterministicHash_IsStableAcrossRuns()
    {
        var a = FixedPointHash.OfFields(1, -2, 3, -4);
        var b = FixedPointHash.OfFields(1, -2, 3, -4);
        Assert.AreEqual(a, b);
        Assert.AreNotEqual(a, FixedPointHash.OfFields(1, -2, 3, -5));
    }
}
