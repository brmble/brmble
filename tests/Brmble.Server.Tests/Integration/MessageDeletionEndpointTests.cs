using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Brmble.Server.DM;
using Brmble.Server.Matrix;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public sealed class MessageDeletionEndpointTests
{
    private const string RoomId = "!general:test";
    private const string DmRoomId = "!dm:test";
    private const string EventId = "$message:test";
    private static readonly DateTimeOffset Now =
        new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public async Task Author_CanDeleteRecentMessage()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                RoomId, EventId, "Deleted through Brmble", null),
            Times.Once);
    }

    [TestMethod]
    public async Task Administrator_CanDeleteOtherUsersRecentMessage()
    {
        using var factory = await FactoryAsync(
            sender: "@bob:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: true);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                RoomId, EventId, "Deleted through Brmble", null),
            Times.Once);
        factory.AclAuthorizationMock.Verify(
            acl => acl.CanModerateServerAsync(factory.AliceUserId),
            Times.Once);
    }

    [TestMethod]
    public async Task NonAdministrator_CannotDeleteOtherUsersMessage()
    {
        using var factory = await FactoryAsync(
            sender: "@bob:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);
        var body = await response.Content.ReadFromJsonAsync<ErrorBody>();

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.AreEqual("not_authorized", body!.Code);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task BridgedAuthor_CanDeleteRecentMessage()
    {
        using var factory = await FactoryAsync(
            sender: "@brmble:test",
            authorMatrixUserId: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                RoomId, EventId, "Deleted through Brmble", null),
            Times.Once);
    }

    [TestMethod]
    public async Task NonAdministrator_CannotDeleteBridgedMessageOwnedByAnotherUser()
    {
        using var factory = await FactoryAsync(
            sender: "@brmble:test",
            authorMatrixUserId: "@bob:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task ExactlyTwentyFourHoursOld_IsRejected()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromHours(24),
            canModerate: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);
        var body = await response.Content.ReadFromJsonAsync<ErrorBody>();

        Assert.AreEqual(HttpStatusCode.Gone, response.StatusCode);
        Assert.AreEqual("expired", body!.Code);
    }

    [TestMethod]
    public async Task AlreadyRedactedMessage_ReturnsConflict()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false,
            isRedacted: true);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);
        var body = await response.Content.ReadFromJsonAsync<ErrorBody>();

        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
        Assert.AreEqual("already_deleted", body!.Code);
    }

    [TestMethod]
    public async Task UnknownRoom_IsRejectedBeforeMatrixRedaction()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false,
            registerRoom: false);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.GetRoomEvent(
                It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task ConcurrentDuplicateRequests_ReturnOkAndConflict()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false);
        factory.MatrixAppMock
            .SetupSequence(matrix => matrix.GetRoomEvent(RoomId, EventId))
            .ReturnsAsync(Event("@alice:test", Now - TimeSpan.FromMinutes(10)))
            .ReturnsAsync(Event(
                "@alice:test",
                Now - TimeSpan.FromMinutes(10),
                isRedacted: true));
        using var client = factory.CreateClient();

        var responses = await Task.WhenAll(
            DeleteAsync(client),
            DeleteAsync(client));

        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            responses.Select(response => response.StatusCode).ToArray());
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                RoomId, EventId, "Deleted through Brmble", null),
            Times.Once);
    }

    [TestMethod]
    public async Task MissingCertificate_IsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client);

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task Author_CanDeleteOwnDmMessage_AsRequester()
    {
        using var factory = await FactoryAsync(
            sender: "@alice:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false,
            registerRoom: false,
            roomId: DmRoomId,
            registerDm: true);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client, DmRoomId);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.GetRoomEvent(DmRoomId, EventId, "@alice:test"),
            Times.Once);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                DmRoomId, EventId, "Deleted through Brmble", "@alice:test"),
            Times.Once);
    }

    [TestMethod]
    public async Task Administrator_CanDeleteOtherUsersDmMessage_AsRequester()
    {
        using var factory = await FactoryAsync(
            sender: "@bob:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: true,
            registerRoom: false,
            roomId: DmRoomId,
            registerDm: true);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client, DmRoomId);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        factory.MatrixAppMock.Verify(
            matrix => matrix.GetRoomEvent(DmRoomId, EventId, "@alice:test"),
            Times.Once);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                DmRoomId, EventId, "Deleted through Brmble", "@alice:test"),
            Times.Once);
    }

    [TestMethod]
    public async Task NonAdministrator_CannotDeleteOtherUsersDmMessage()
    {
        using var factory = await FactoryAsync(
            sender: "@bob:test",
            timestamp: Now - TimeSpan.FromMinutes(10),
            canModerate: false,
            registerRoom: false,
            roomId: DmRoomId,
            registerDm: true);
        using var client = factory.CreateClient();

        var response = await DeleteAsync(client, DmRoomId);
        var body = await response.Content.ReadFromJsonAsync<ErrorBody>();

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.AreEqual("not_authorized", body!.Code);
        factory.MatrixAppMock.Verify(
            matrix => matrix.RedactRoomEvent(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()),
            Times.Never);
    }

    private static async Task<BrmbleServerFactory> FactoryAsync(
        string sender,
        DateTimeOffset timestamp,
        bool canModerate,
        bool isRedacted = false,
        bool registerRoom = true,
        string? authorMatrixUserId = null,
        string roomId = RoomId,
        bool registerDm = false)
    {
        var factory = new BrmbleServerFactory();
        factory.MatrixAppMock
            .Setup(matrix => matrix.GetRoomEvent(roomId, EventId, It.IsAny<string?>()))
            .ReturnsAsync(Event(sender, timestamp, isRedacted, authorMatrixUserId));
        if (registerRoom)
        {
            await factory.Services
                .GetRequiredService<ChannelRepository>()
                .InsertAsync(42, RoomId);
        }
        if (registerDm)
        {
            var bob = await factory.Users.Insert("bob-cert", "Bob");
            await factory.Services
                .GetRequiredService<DmRoomRepository>()
                .InsertAsync(factory.AliceUserId, bob.Id, DmRoomId);
        }
        _ = factory.Services;
        factory.AclAuthorizationMock
            .Setup(acl => acl.CanModerateServerAsync(factory.AliceUserId))
            .ReturnsAsync(canModerate);
        return factory;
    }

    private static JsonElement Event(
        string sender,
        DateTimeOffset timestamp,
        bool isRedacted = false,
        string? authorMatrixUserId = null)
    {
        var content = new JsonObject
        {
            ["msgtype"] = "m.text",
            ["body"] = authorMatrixUserId is null ? "hello" : "[Alice]: hello"
        };
        if (authorMatrixUserId is not null)
            content["com.brmble.author_matrix_user_id"] = authorMatrixUserId;

        return JsonSerializer.SerializeToElement(new
        {
            type = "m.room.message",
            sender,
            origin_server_ts = timestamp.ToUnixTimeMilliseconds(),
            content,
            unsigned = isRedacted
                ? new { redacted_because = new { type = "m.room.redaction" } }
                : null
        });
    }

    private static Task<HttpResponseMessage> DeleteAsync(
        HttpClient client,
        string roomId = RoomId) =>
        client.PostAsJsonAsync("/messages/delete", new
        {
            roomId,
            eventId = EventId
        });

    private sealed record ErrorBody(string Code, string Error);
}
