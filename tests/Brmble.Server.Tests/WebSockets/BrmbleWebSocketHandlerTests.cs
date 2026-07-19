using Brmble.Server.Events;
using Brmble.Server.WebSockets;
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
}
