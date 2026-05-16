using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AclAdminEndpointTests
{
    [TestMethod]
    public async Task GetChannelAcl_Unauthenticated_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/acl/channels/4");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelAcl_WithoutMumbleWritePermission_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_acl_forbidden");
        await SeedUser(factory, "cert_acl_forbidden", "Alice");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(It.IsAny<long>(), 4)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/acl/channels/4");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task PutChannelAcl_ReturnsRefreshedCanonicalSnapshot()
    {
        using var factory = new BrmbleServerFactory("cert_acl_admin");
        var user = await SeedUser(factory, "cert_acl_admin", "Admin");
        var snapshot = new AclChannelSnapshotDto(4, true, [], [], DateTimeOffset.UtcNow, false, null);
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 4)).ReturnsAsync(true);
        factory.AclCoordinatorMock.Setup(c => c.WriteAndRefreshAsync(4, It.IsAny<AclUpdateRequest>()))
            .ReturnsAsync(new AclWriteResult(true, snapshot, null, null));
        var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/acl/channels/4", new AclUpdateRequest(true, [], [], "known-hash"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<AclWriteResult>();
        Assert.IsTrue(result!.Success);
        Assert.AreEqual(4, result.Snapshot!.ChannelId);
    }

    private static async Task<User> SeedUser(BrmbleServerFactory factory, string certHash, string name)
    {
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        return await repo.Insert(certHash, name);
    }
}
