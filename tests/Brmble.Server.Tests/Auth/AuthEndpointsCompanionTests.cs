using System.Net;
using System.Text;
using System.Text.Json;
using System.Net.Http.Json;
using Brmble.Server.Companions;
using Brmble.Server.Events;
using Brmble.Server.Tests.Integration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthEndpointsCompanionTests : IDisposable
{
    private readonly CompanionAuthFactory _factory = new();
    private readonly HttpClient _client;

    public AuthEndpointsCompanionTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostAuthCompanion_PersistsAndBroadcastsToAllClients()
    {
        var tokenResponse = await _client.PostAsync("/auth/token", null);
        tokenResponse.EnsureSuccessStatusCode();

        var channelMembership = _factory.Services.GetRequiredService<IChannelMembershipService>();
        channelMembership.Update(42, 7);

        _factory.SessionMappingMock
            .Setup(m => m.TryGetMappingByUserId(
                It.IsAny<long>(), out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long userId, out int sid, out SessionMapping? mapping) =>
            {
                sid = 42;
                mapping = new SessionMapping("@alice:test", "Alice", userId, "floppy");
                return true;
            });
        _factory.SessionMappingMock
            .Setup(m => m.TryUpdateCompanionIdIfOwnedBy(42, 1, "floppy"))
            .Returns(true);

        var response = await _client.PostAsync(
            "/auth/companion",
            new StringContent(JsonSerializer.Serialize(new { companionId = "floppy" }), Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        _factory.SessionMappingMock.Verify(m => m.TryUpdateCompanionIdIfOwnedBy(42, 1, "floppy"), Times.Once);
        _factory.EventBusMock.Verify(b => b.BroadcastAsync(It.Is<object>(payload =>
            JsonSerializer.Serialize(payload).Contains("\"type\":\"companionChanged\""))), Times.Once);
        _factory.EventBusMock.Verify(
            b => b.BroadcastToChannelAsync(It.IsAny<int>(), It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task PostAuthCompanion_BroadcastsEvenWhenChannelIsUnknown()
    {
        var tokenResponse = await _client.PostAsync("/auth/token", null);
        tokenResponse.EnsureSuccessStatusCode();

        // Deliberately no channelMembership.Update: the session has no resolvable channel,
        // which previously suppressed the broadcast entirely.
        _factory.SessionMappingMock
            .Setup(m => m.TryGetMappingByUserId(
                It.IsAny<long>(), out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long userId, out int sid, out SessionMapping? mapping) =>
            {
                sid = 99;
                mapping = new SessionMapping("@alice:test", "Alice", userId, "floppy");
                return true;
            });
        _factory.SessionMappingMock
            .Setup(m => m.TryUpdateCompanionIdIfOwnedBy(99, 1, "retro"))
            .Returns(true);

        var response = await _client.PostAsync(
            "/auth/companion",
            new StringContent(JsonSerializer.Serialize(new { companionId = "retro" }), Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        _factory.EventBusMock.Verify(b => b.BroadcastAsync(It.Is<object>(payload =>
            JsonSerializer.Serialize(payload).Contains("\"sessionId\":99"))), Times.Once);
    }

    [TestMethod]
    public async Task PostAuthCompanion_DoesNotBroadcastWhenSessionMappingIsMissing()
    {
        var tokenResponse = await _client.PostAsync("/auth/token", null);
        tokenResponse.EnsureSuccessStatusCode();

        // _userIdToSession can outlive _sessionToMapping (TryAddMatrixUser writes the
        // userId index even when the mapping add fails), so a userId lookup can resolve
        // to a session that has no mapping — or one now owned by a different user.
        _factory.SessionMappingMock
            .Setup(m => m.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int sid) =>
            {
                sid = 42;
                return true;
            });
        _factory.SessionMappingMock
            .Setup(m => m.TryGetMappingByUserId(
                It.IsAny<long>(), out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long _, out int sid, out SessionMapping? mapping) =>
            {
                sid = 0;
                mapping = null;
                return false;
            });

        var response = await _client.PostAsync(
            "/auth/companion",
            new StringContent(JsonSerializer.Serialize(new { companionId = "bee" }), Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("bee", await _factory.Services
            .GetRequiredService<Brmble.Server.Auth.UserRepository>().GetCompanionId(1));
        _factory.EventBusMock.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
        _factory.SessionMappingMock.Verify(
            m => m.TryUpdateCompanionIdIfOwnedBy(It.IsAny<int>(), It.IsAny<long>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task PostAuthCompanion_DoesNotBroadcastWhenSessionIsRecycledDuringUpdate()
    {
        var tokenResponse = await _client.PostAsync("/auth/token", null);
        tokenResponse.EnsureSuccessStatusCode();

        // The mapping lookup validates ownership, but the session can still be removed and
        // recycled to a different user before the write lands. The CAS on userId rejects it,
        // so nothing is announced under the new owner's session.
        _factory.SessionMappingMock
            .Setup(m => m.TryGetMappingByUserId(
                It.IsAny<long>(), out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long userId, out int sid, out SessionMapping? mapping) =>
            {
                sid = 42;
                mapping = new SessionMapping("@alice:test", "Alice", userId, "floppy");
                return true;
            });
        _factory.SessionMappingMock
            .Setup(m => m.TryUpdateCompanionIdIfOwnedBy(42, It.IsAny<long>(), It.IsAny<string>()))
            .Returns(false);

        var response = await _client.PostAsync(
            "/auth/companion",
            new StringContent(JsonSerializer.Serialize(new { companionId = "bee" }), Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("bee", await _factory.Services
            .GetRequiredService<Brmble.Server.Auth.UserRepository>().GetCompanionId(1));
        _factory.EventBusMock.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task CompanionEndpoint_AcceptsOnlyActiveCustomEventFromThisServer()
    {
        var gallery = _factory.Services.GetRequiredService<CustomCompanionRepository>();
        await gallery.InsertAsync(new CustomCompanionRecord(
            "$local:test", "local", "!gallery:test", 1, "@alice:test", "Alice",
            "Orbit", "mxc://test/media", "image/png", 1536, 1872, 1, 1024,
            DateTimeOffset.Parse("2026-07-29T10:00:00Z"), null, null));

        Assert.AreEqual(HttpStatusCode.OK,
            (await _client.PostAsJsonAsync(
                "/auth/companion", new { companionId = "custom:$local:test" })).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync(
                "/auth/companion", new { companionId = "custom:$other:test" })).StatusCode);
        Assert.AreEqual("custom:$local:test", await _factory.Services
            .GetRequiredService<Brmble.Server.Auth.UserRepository>().GetCompanionId(1));
    }

    [TestMethod]
    public async Task AuthToken_IncludesGalleryCapabilityOnlyAfterSuccessfulJoin()
    {
        _factory.MatrixAppMock.Setup(service => service.CreateCustomCompanionGalleryRoom())
            .ReturnsAsync("!gallery:test");
        _factory.MatrixAppMock.Setup(service => service.EnsureUserInRoom("alice", "!gallery:test"))
            .ReturnsAsync(true);
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);

        using var document = JsonDocument.Parse(await (await _client.PostAsync("/auth/token", null)).Content.ReadAsStringAsync());
        var capability = document.RootElement.GetProperty("matrix").GetProperty("customCompanions");

        Assert.AreEqual("!gallery:test", capability.GetProperty("galleryRoomId").GetString());
        Assert.IsTrue(capability.GetProperty("canModerate").GetBoolean());
        Assert.AreEqual("floppy", capability.GetProperty("selectedCompanionId").GetString());
    }

    [TestMethod]
    public async Task AuthToken_OmitsGalleryCapabilityWhenJoinFails()
    {
        _factory.MatrixAppMock.Setup(service => service.CreateCustomCompanionGalleryRoom())
            .ReturnsAsync("!gallery:test");
        _factory.MatrixAppMock.Setup(service => service.EnsureUserInRoom("alice", "!gallery:test"))
            .ReturnsAsync(false);

        using var document = JsonDocument.Parse(await (await _client.PostAsync("/auth/token", null)).Content.ReadAsStringAsync());

        Assert.IsFalse(document.RootElement.GetProperty("matrix").TryGetProperty("customCompanions", out _));
    }

    [TestMethod]
    public async Task AuthToken_OmitsGalleryCapabilityWhenRoomCreationFails()
    {
        _factory.MatrixAppMock.Setup(service => service.CreateCustomCompanionGalleryRoom())
            .ThrowsAsync(new InvalidOperationException("Matrix unavailable"));

        using var document = JsonDocument.Parse(await (await _client.PostAsync("/auth/token", null)).Content.ReadAsStringAsync());

        Assert.IsFalse(document.RootElement.GetProperty("matrix").TryGetProperty("customCompanions", out _));
    }

    [TestMethod]
    public async Task AuthToken_SessionMappingsUseLegacySafeCustomWireFields()
    {
        _factory.SessionMappingMock.Setup(service => service.GetSnapshot()).Returns(
            new Dictionary<int, SessionMapping>
            {
                [42] = new("@alice:test", "Alice", 1, "custom:$sprite:test")
            });

        using var document = JsonDocument.Parse(await (await _client.PostAsync("/auth/token", null)).Content.ReadAsStringAsync());
        var mapping = document.RootElement.GetProperty("sessionMappings").GetProperty("42");

        Assert.AreEqual("floppy", mapping.GetProperty("companionId").GetString());
        Assert.AreEqual("custom:$sprite:test", mapping.GetProperty("customCompanionId").GetString());
    }

    private sealed class CompanionAuthFactory : BrmbleServerFactory
    {
        // Deliberately hides the base factory's mock: this suite removes the inherited
        // ISessionMappingService registration and substitutes a bare mock, so the base's
        // real-behaviour callbacks must not apply here.
        public new Mock<ISessionMappingService> SessionMappingMock { get; } = new();
        public Mock<IBrmbleEventBus> EventBusMock { get; } = new();

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                var mappingDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(ISessionMappingService));
                if (mappingDescriptor is not null) services.Remove(mappingDescriptor);

                var eventBusDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(IBrmbleEventBus));
                if (eventBusDescriptor is not null) services.Remove(eventBusDescriptor);

                SessionMappingMock.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
                SessionMappingMock.Setup(m => m.TryGetSessionId(It.IsAny<string>(), out It.Ref<int>.IsAny)).Returns(false);
                SessionMappingMock.Setup(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<long>(), It.IsAny<string>())).Returns(false);
                SessionMappingMock.Setup(m => m.TryUpdateBrmbleStatus(It.IsAny<int>(), It.IsAny<bool>())).Returns(true);

                EventBusMock.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
                EventBusMock.Setup(b => b.BroadcastToChannelAsync(It.IsAny<int>(), It.IsAny<object>())).Returns(Task.CompletedTask);

                services.AddSingleton(SessionMappingMock.Object);
                services.AddSingleton(EventBusMock.Object);
            });
        }
    }
}
