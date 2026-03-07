using System.Net;
using System.Net.Http.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ScreenShareEndpointTests
{
    [TestMethod]
    public async Task ShareStarted_ThenActiveShare_ReturnsShareInfo()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var startResp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        Assert.AreEqual(HttpStatusCode.OK, startResp.StatusCode);

        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.OK, activeResp.StatusCode);
        var body = await activeResp.Content.ReadFromJsonAsync<ActiveShareResponse>();
        Assert.AreEqual("maui", body?.UserName);
    }

    [TestMethod]
    public async Task ShareStopped_ThenActiveShare_Returns404()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        await client.PostAsJsonAsync("/livekit/share-stopped", new { roomName = "channel-4" });

        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.NotFound, activeResp.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_NoShare_Returns404()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var resp = await client.GetAsync("/livekit/active-share?roomName=channel-99");
        Assert.AreEqual(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [TestMethod]
    public async Task ShareStarted_NoCert_Returns401()
    {
        await using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var resp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-1" });
        Assert.AreEqual(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private record ActiveShareResponse(string UserName, string MatrixUserId);
}
