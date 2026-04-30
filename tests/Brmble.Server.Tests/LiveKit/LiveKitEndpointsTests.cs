using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Tests.Integration;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitEndpointsTests
{
    [TestMethod]
    public async Task TokenRequest_WithoutAccessMode_ReturnsBadRequest()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1" });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_WithoutClientIdentity_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_WithNumericAccessMode_ReturnsBadRequest()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "1" });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
