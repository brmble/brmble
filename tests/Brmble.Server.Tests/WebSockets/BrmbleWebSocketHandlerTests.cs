using Brmble.Server.Events;
using Brmble.Server.WebSockets;
using Brmble.Server.Companions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.WebSockets;

[TestClass]
public class BrmbleWebSocketHandlerTests
{
    [TestMethod]
    public void CreateUserMappingAddedPayload_UsesAuthoritativeCertHash()
    {
        var mapping = new SessionMapping(
            MatrixUserId: "@alice:test.local",
            MumbleName: "Alice",
            UserId: 42,
            CompanionId: "floppy",
            CertHash: null,
            IsBrmbleClient: false);

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("fresh-hash", payload.GetType().GetProperty("certHash")!.GetValue(payload));
    }

    [TestMethod]
    public void WireSelection_CustomValueKeepsLegacyFieldSafe()
    {
        var wire = CompanionWireSelection.FromPersisted("custom:$sprite:test");

        Assert.AreEqual("floppy", wire.CompanionId);
        Assert.AreEqual("custom:$sprite:test", wire.CustomCompanionId);
    }

    [TestMethod]
    public void CreateUserMappingAddedPayload_CustomCompanionUsesDualWireFields()
    {
        var mapping = new SessionMapping("@alice:test", "Alice", 42, "custom:$sprite:test");

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("floppy", payload.GetType().GetProperty("companionId")!.GetValue(payload));
        Assert.AreEqual("custom:$sprite:test", payload.GetType().GetProperty("customCompanionId")!.GetValue(payload));
    }

    [TestMethod]
    public void CreateUserMappingAddedPayload_BuiltInKeepsLegacyFieldAndEmptyCustomField()
    {
        var mapping = new SessionMapping("@alice:test", "Alice", 42, "floppy");

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("floppy", payload.GetType().GetProperty("companionId")!.GetValue(payload));
        Assert.IsNull(payload.GetType().GetProperty("customCompanionId")!.GetValue(payload));
    }
}
