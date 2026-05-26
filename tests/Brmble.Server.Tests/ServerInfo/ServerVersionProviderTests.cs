using Brmble.Server.ServerInfo;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.ServerInfo;

[TestClass]
public class ServerVersionProviderTests
{
    [TestMethod]
    public void Version_IsNonEmpty()
    {
        var provider = new ServerVersionProvider();
        Assert.IsFalse(string.IsNullOrWhiteSpace(provider.Version),
            "Version must be a non-empty string (MinVer or fallback).");
    }

    [TestMethod]
    public void Version_DoesNotStartWithV()
    {
        // MinVer output is SemVer without a 'v' prefix. The 'v' is applied
        // only in the frontend display. Keep the provider format stable.
        var provider = new ServerVersionProvider();
        Assert.IsFalse(provider.Version.StartsWith("v", StringComparison.OrdinalIgnoreCase),
            $"Version should be SemVer without 'v' prefix, got '{provider.Version}'.");
    }

    [TestMethod]
    public void FormatVersion_ForRelease_ReturnsSemVer()
    {
        Assert.AreEqual("1.2.3", ServerVersionProvider.FormatVersion("1.2.3", null));
    }

    [TestMethod]
    public void FormatVersion_ForReleaseWithSourceRevision_ReturnsSemVer()
    {
        Assert.AreEqual("1.2.3", ServerVersionProvider.FormatVersion("1.2.3+8f4a2c91b7e0", null));
    }

    [TestMethod]
    public void FormatVersion_ForMainBuild_ReturnsDevMainShortSha()
    {
        Assert.AreEqual("Dev main 8f4a2c9", ServerVersionProvider.FormatVersion("0.0.0-alpha.0", "8f4a2c91b7e0"));
    }

    [TestMethod]
    public void FormatVersion_ForMainBuildWithoutSha_ReturnsDevMain()
    {
        Assert.AreEqual("Dev main", ServerVersionProvider.FormatVersion("0.0.0-alpha.0", null));
    }
}
