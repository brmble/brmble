using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ChannelChatAccessEndpointTests
{
    [TestMethod]
    public async Task GetChannelChatAccess_Unauthenticated_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1]));

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelChatAccess_AuthenticatedButNoLiveMumbleSession_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_chat_no_session");
        var user = await SeedUser(factory, "cert_chat_no_session", "Alice");
        var ignoredSession = 0;
        factory.SessionMappingMock
            .Setup(s => s.TryGetSessionByUserId(user.Id, out ignoredSession))
            .Returns(false);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1]));

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelChatAccess_ReturnsTextMessageAccessForEachValidChannel()
    {
        using var factory = new BrmbleServerFactory("cert_chat_access");
        var user = await SeedUser(factory, "cert_chat_access", "Alice");
        var sessionId = 42;
        factory.SessionMappingMock
            .Setup(s => s.TryGetSessionByUserId(user.Id, out sessionId))
            .Returns(true);
        factory.MumbleAclMock.Setup(a => a.HasTextMessagePermissionAsync(42, 1)).ReturnsAsync(true);
        factory.MumbleAclMock.Setup(a => a.HasTextMessagePermissionAsync(42, 2)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1, 2, 0, -5, 1]));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<ChannelChatAccessResponse>();
        Assert.IsNotNull(result);
        Assert.AreEqual(2, result.Channels.Count);
        Assert.IsTrue(result.Channels["1"].CanRead);
        Assert.IsTrue(result.Channels["1"].CanSend);
        Assert.IsFalse(result.Channels["2"].CanRead);
        Assert.IsFalse(result.Channels["2"].CanSend);
        factory.MumbleAclMock.Verify(a => a.HasTextMessagePermissionAsync(42, 1), Times.Once);
    }

    private static async Task<User> SeedUser(BrmbleServerFactory factory, string certHash, string name)
    {
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        return await repo.Insert(certHash, name);
    }
}
