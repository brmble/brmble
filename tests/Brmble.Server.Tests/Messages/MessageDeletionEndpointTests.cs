using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Messages;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Messages;

[TestClass]
public sealed class MessageDeletionEndpointTests
{
    [TestMethod]
    public async Task RedactMessage_RegularUserOwnRecentMessage_ReturnsOk()
    {
        using var factory = new Integration.BrmbleServerFactory(certHash: null);
        factory.AclAuthorizationMock
            .Setup(a => a.CanManageChannelAclAsync(It.IsAny<long>(), 0))
            .ReturnsAsync(false);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        var user = await repo.Insert("cert-delete-alice", "Alice");
        await repo.UpdateMatrixToken(user.Id, "alice-token");

        factory.MatrixAppServiceMock
            .Setup(m => m.GetRoomEventAsync("!room:example.com", "$event:example.com", "alice-token", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MatrixTimelineEventInfo(
                "!room:example.com",
                "$event:example.com",
                user.MatrixUserId,
                DateTimeOffset.UtcNow.AddMinutes(-10),
                "m.room.message",
                false,
                false));

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "alice-token");

        var response = await client.PostAsJsonAsync("/messages/redact", new DeleteMessageRequest("!room:example.com", "$event:example.com", null));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeleteMessageResponse>();
        Assert.IsNotNull(body);
        Assert.AreEqual(MessageDeletionReasons.SelfDelete, body.Reason);
    }

    [TestMethod]
    public async Task RedactMessage_AlreadyDeleted_ReturnsConflict()
    {
        using var factory = new Integration.BrmbleServerFactory(certHash: null);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        var user = await repo.Insert("cert-delete-alice-2", "Alice");
        await repo.UpdateMatrixToken(user.Id, "alice-token-2");

        factory.MatrixAppServiceMock
            .Setup(m => m.GetRoomEventAsync("!room:example.com", "$event:example.com", "alice-token-2", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MatrixTimelineEventInfo(
                "!room:example.com",
                "$event:example.com",
                user.MatrixUserId,
                DateTimeOffset.UtcNow.AddMinutes(-10),
                "m.room.message",
                true,
                false));

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "alice-token-2");

        var response = await client.PostAsJsonAsync("/messages/redact", new DeleteMessageRequest("!room:example.com", "$event:example.com", null));

        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
    }

    [TestMethod]
    public async Task RedactMessage_PreflightFromDesktopOrigin_AllowsAuthorizationHeader()
    {
        using var factory = new Integration.BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Options, "/messages/redact");
        request.Headers.Add("Origin", "https://brmble.local");
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "authorization,content-type");

        var response = await client.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.NoContent, response.StatusCode);
        Assert.AreEqual("https://brmble.local", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        StringAssert.Contains(string.Join(",", response.Headers.GetValues("Access-Control-Allow-Headers")), "authorization");
    }
}
