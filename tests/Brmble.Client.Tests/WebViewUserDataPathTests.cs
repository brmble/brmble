using Brmble.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class WebViewUserDataPathTests
{
    [TestMethod]
    public void StablePathUsesBrmbleFolderUnderLocalApplicationData()
    {
        var path = WebViewUserDataPath.GetStablePath("C:\\Users\\alice\\AppData\\Local");

        Assert.AreEqual(
            Path.GetFullPath("C:\\Users\\alice\\AppData\\Local\\Brmble\\WebView2"),
            path);
    }

    [TestMethod]
    public void StablePathDoesNotDependOnExecutableDirectory()
    {
        var path = WebViewUserDataPath.GetStablePath("C:\\Users\\alice\\AppData\\Local");

        Assert.IsFalse(path.Contains("app-1.2.3", StringComparison.OrdinalIgnoreCase));
        StringAssert.EndsWith(path, Path.Combine("Brmble", "WebView2"));
    }

    [TestMethod]
    public void KnownLegacyPathsIncludeThePreviousVelopackProfile()
    {
        var paths = WebViewUserDataPath.GetKnownLegacyPaths("C:\\Users\\alice\\AppData\\Local");

        Assert.AreEqual(
            Path.GetFullPath("C:\\Users\\alice\\AppData\\Local\\Brmble\\current\\Brmble.Client.exe.WebView2"),
            paths[0]);
    }
}
