using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionTests
{
    [TestMethod]
    public void CertHash_PrefersMumbleOverServer()
    {
        // Mumble observes the certificate on the live connection; the server's copy is a
        // record of one. When both exist the live one wins, matching today's behaviour.
        var row = new UserProjection
        {
            SessionId = 1,
            MumbleCertHash = "from-mumble",
            ServerCertHash = "from-server"
        };

        Assert.AreEqual("from-mumble", row.CertHash);
    }

    [TestMethod]
    public void CertHash_FallsBackToServerWhenMumbleHasNone()
    {
        var row = new UserProjection { SessionId = 1, ServerCertHash = "from-server" };

        Assert.AreEqual("from-server", row.CertHash);
    }

    [TestMethod]
    public void CertHash_IsNullWhenNeitherSourceKnows()
    {
        Assert.IsNull(new UserProjection { SessionId = 1 }.CertHash);
    }
}
