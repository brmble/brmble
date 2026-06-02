using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ChannelRequestEndpointTests
{
    [TestMethod]
    public async Task PostChannelRequests_Unauthenticated_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/channel-requests", new { channelName = "Raid Team 2" });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task GetAdminChannelRequests_WithoutAdminPermission_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_non_admin");
        var user = await SeedUser(factory, "cert_non_admin", "Alice");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/admin/channel-requests");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAdminApprove_WithoutAdminPermission_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_non_admin");
        var user = await SeedUser(factory, "cert_non_admin", "Alice");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.PostAsync("/admin/channel-requests/5/approve", null);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task PostChannelRequests_Authenticated_ReturnsCreated()
    {
        using var factory = new BrmbleServerFactory("cert_requester");
        await SeedUser(factory, "cert_requester", "Alice");
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/channel-requests", new { channelName = "Raid Team 2", reason = "Weekly runs" });

        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ChannelRequestDto>();
        Assert.IsNotNull(payload);
        Assert.AreEqual("Raid Team 2", payload.ChannelName);
    }

    [TestMethod]
    public async Task GetAdminChannelRequests_AdminUser_ReturnsPendingItems()
    {
        using var factory = new BrmbleServerFactory("cert_admin");
        var user = await SeedUser(factory, "cert_admin", "Admin");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(true);
        var client = factory.CreateClient();

        await client.PostAsJsonAsync("/channel-requests", new { channelName = "Raid Team 2" });
        var response = await client.GetAsync("/admin/channel-requests");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ChannelRequestListResponse>();
        Assert.IsNotNull(payload);
        Assert.AreEqual(1, payload.Items.Count);
    }

    [TestMethod]
    public async Task PostAdminApprove_AdminUser_ReturnsApprovedRequest()
    {
        using var factory = new BrmbleServerFactory("cert_admin");
        var user = await SeedUser(factory, "cert_admin", "Admin");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(true);
        var client = factory.CreateClient();

        var createResponse = await client.PostAsJsonAsync("/channel-requests", new { channelName = "Raid Team 2" });
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelRequestDto>();
        var response = await client.PostAsync($"/admin/channel-requests/{created!.Id}/approve", null);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ChannelRequestDto>();
        Assert.IsNotNull(payload);
        Assert.AreEqual(ChannelRequestStatus.Approved, payload.Status);
    }

    [TestMethod]
    public async Task PostChannelRequests_FourthPendingRequest_ReturnsTooManyRequests()
    {
        using var factory = new BrmbleServerFactory("cert_pending_limit");
        await SeedUser(factory, "cert_pending_limit", "Alice");
        var client = factory.CreateClient();

        for (var i = 1; i <= 3; i++)
        {
            var created = await client.PostAsJsonAsync("/channel-requests", new { channelName = $"Raid Team {i}" });
            Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        }

        var limited = await client.PostAsJsonAsync("/channel-requests", new { channelName = "Raid Team 4" });
        Assert.AreEqual(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    private static async Task<User> SeedUser(BrmbleServerFactory factory, string certHash, string name)
    {
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        return await repo.Insert(certHash, name);
    }
}
