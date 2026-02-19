using Brmble.Server.LiveKit;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceTests
{
    // TODO: Add tests as GenerateToken is implemented:
    // - GenerateToken_ValidCertHash_ReturnsJwt
    // - GenerateToken_UnknownCertHash_ThrowsOrReturnsNull

    [TestMethod]
    public void Constructor_DoesNotThrow()
    {
        var svc = new LiveKitService();
        Assert.IsNotNull(svc);
    }
}
