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
}
