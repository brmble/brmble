using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Events;
using Brmble.Server.LiveKit;
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
    public async Task ActiveShare_WithoutCurrentChannelAccess_ReturnsShareMetadata()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var tracker = factory.Services.GetRequiredService<ScreenShareTracker>();
        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();

        sessionMapping.SetNameForSession("TestUser", 7);

        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });

        channelMembership.Update(7, 2);
        Assert.IsTrue(sessionMapping.TryAddMatrixUser(11, "@sharer:localhost", "Sharer", 42));
        channelMembership.Update(11, 1);
        Assert.IsTrue(tracker.Start("channel-1", "Sharer", 42, "@sharer:localhost"));

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ActiveSharesResponse>();

        Assert.IsNotNull(body?.Shares);
        Assert.AreEqual(1, body.Shares.Length);
        Assert.AreEqual("Sharer", body.Shares[0].UserName);
        Assert.AreEqual(42L, body.Shares[0].UserId);
        Assert.AreEqual("@sharer:localhost", body.Shares[0].MatrixUserId);
        Assert.AreEqual(11, body.Shares[0].SessionId);
    }

    [TestMethod]
    public async Task ActiveShare_WithCurrentChannelAccess_StillReturnsOk()
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

    [TestMethod]
    public async Task ActiveShare_RootGlobalRequest_ReturnsAllActiveShares()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var tracker = factory.Services.GetRequiredService<ScreenShareTracker>();
        tracker.Start("channel-1", "alice", 10, "@alice:test");
        tracker.Start("channel-2", "bob", 20, "@bob:test");

        var response = await client.GetAsync("/livekit/active-share?scope=all");
        var payload = await response.Content.ReadAsStringAsync();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        StringAssert.Contains(payload, "channel-1");
        StringAssert.Contains(payload, "channel-2");
    }

    [TestMethod]
    public async Task ActiveShare_ChannelRequest_StillReturnsOnlyRequestedRoom()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        await client.PostAsync("/auth/token", null);

        var tracker = factory.Services.GetRequiredService<ScreenShareTracker>();
        tracker.Start("channel-1", "alice", 10, "@alice:test");
        tracker.Start("channel-2", "bob", 20, "@bob:test");

        var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");
        var payload = await response.Content.ReadAsStringAsync();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        StringAssert.Contains(payload, "channel-1");
        Assert.IsFalse(payload.Contains("channel-2"));
    }

    private record ActiveShareInfo(string UserName, long UserId, string MatrixUserId, int? SessionId);
    private record ActiveSharesResponse(ActiveShareInfo[] Shares);
}
