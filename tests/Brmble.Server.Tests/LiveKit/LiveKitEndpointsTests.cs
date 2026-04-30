using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Events;
using Brmble.Server.Tests.Integration;
using Microsoft.Extensions.DependencyInjection;
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

    [TestMethod]
    public async Task TokenRequest_WithNumericJsonAccessMode_ReturnsBadRequest()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = 1 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_WithoutClientIdentity_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_WithUnknownCertHash_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: "unknowncerthash999");
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_PublishWithoutCurrentChannelAccess_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "publish" });

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_SubscribeWithoutCurrentChannelAccess_ReturnsOk()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_SubscribeWithCurrentChannelAccess_ReturnsOk()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();

        sessionMapping.SetNameForSession("TestUser", 7);

        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });

        channelMembership.Update(7, 1);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_PublishWithCurrentChannelAccess_ReturnsOk()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();

        sessionMapping.SetNameForSession("TestUser", 7);

        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });

        channelMembership.Update(7, 1);

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "publish" });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_WithoutCurrentChannelAccess_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_WithCurrentChannelAccess_ReturnsOk()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();

        sessionMapping.SetNameForSession("TestUser", 7);

        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });

        channelMembership.Update(7, 1);

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }
}
