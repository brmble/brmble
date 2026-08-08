using Brmble.Server.Companions;
using Brmble.Server.WebSockets;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.WebSockets;

[TestClass]
public class ProjectionVersionTests
{
    [TestMethod]
    public void AbsentQueryParameterIsVersionZero() =>
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion(null));

    [TestMethod]
    public void ParsesAnExplicitVersion() =>
        Assert.AreEqual(1, BrmbleWebSocketHandler.ParseProjectionVersion("1"));

    [TestMethod]
    public void GarbageIsVersionZero()
    {
        // A malformed parameter must degrade to the legacy shape, never throw a client off.
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion("banana"));
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion("-3"));
    }

    [TestMethod]
    public void Version1SendsTheCustomSelectionInCompanionId()
    {
        var wire = CompanionWireSelection.For("custom:$abc", projectionVersion: 1);

        Assert.AreEqual("custom:$abc", wire.CompanionId);
        Assert.IsNull(wire.CustomCompanionId, "the split exists only for clients that need it");
    }

    [TestMethod]
    public void Version0KeepsTheLegacySplit()
    {
        var wire = CompanionWireSelection.For("custom:$abc", projectionVersion: 0);

        Assert.AreEqual("floppy", wire.CompanionId);
        Assert.AreEqual("custom:$abc", wire.CustomCompanionId);
    }

    [TestMethod]
    public void AnUnknownCompanionIsNullAtVersion1()
    {
        // Absent must not be transmitted as "floppy": that is the defect the design removes.
        Assert.IsNull(CompanionWireSelection.For(null, projectionVersion: 1).CompanionId);
    }

    [TestMethod]
    public void AnUnknownCompanionIsAlsoNullAtVersion0()
    {
        // The legacy split is about custom skins, not about inventing a companion for a mapping
        // that has none. FromPersisted(null) must not manufacture a floppy either.
        var wire = CompanionWireSelection.For(null, projectionVersion: 0);

        Assert.IsNull(wire.CompanionId);
        Assert.IsNull(wire.CustomCompanionId);
    }

    [TestMethod]
    public void ABuiltInCompanionIsUnchangedByTheVersion()
    {
        Assert.AreEqual("retro", CompanionWireSelection.For("retro", projectionVersion: 0).CompanionId);
        Assert.AreEqual("retro", CompanionWireSelection.For("retro", projectionVersion: 1).CompanionId);
    }
}
