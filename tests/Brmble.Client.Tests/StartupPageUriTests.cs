using Brmble.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests;

[TestClass]
public sealed class StartupPageUriTests
{
    [TestMethod]
    public void DevServerLoadingUsesTheProvidedUrl()
    {
        var uri = StartupPageUri.Build(true, "http://localhost:5173", StartupPageState.Loading);

        Assert.AreEqual("http://localhost:5173/startup.html", uri);
    }

    [TestMethod]
    public void DevServerUrlTrailingSlashIsTrimmed()
    {
        var uri = StartupPageUri.Build(true, "http://localhost:5173///", StartupPageState.Loading);

        Assert.AreEqual("http://localhost:5173/startup.html", uri);
    }

    [TestMethod]
    public void PackagedLoadingUsesTheVirtualHost()
    {
        var uri = StartupPageUri.Build(false, "http://ignored.test", StartupPageState.Loading);

        Assert.AreEqual("https://brmble.local/startup.html", uri);
    }

    [TestMethod]
    public void PackagedErrorAddsOnlyTheErrorStateQuery()
    {
        var uri = StartupPageUri.Build(false, "http://ignored.test", StartupPageState.Error);

        Assert.AreEqual("https://brmble.local/startup.html?state=error", uri);
    }
}
