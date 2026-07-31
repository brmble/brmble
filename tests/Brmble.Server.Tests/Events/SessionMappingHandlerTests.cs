using Brmble.Server.Auth;
using Brmble.Server.Companions;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using System.Text.Json;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class SessionMappingHandlerTests
{
    private SqliteConnection _keepAlive = null!;
    private UserRepository _repo = null!;
    private Mock<ISessionMappingService> _mapping = null!;
    private Mock<IBrmbleEventBus> _bus = null!;
    private Mock<IActiveBrmbleSessions> _activeSessions = null!;
    private SessionMappingHandler _handler = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "smh_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        _repo = new UserRepository(db, Options.Create(new MatrixSettings { ServerDomain = "test.local" }));
        _mapping = new Mock<ISessionMappingService>();
        _bus = new Mock<IBrmbleEventBus>();
        _bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        _activeSessions = new Mock<IActiveBrmbleSessions>();
        _handler = new SessionMappingHandler(_mapping.Object, _bus.Object, _repo, _activeSessions.Object, NullLogger<SessionMappingHandler>.Instance);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task OnUserConnected_WithKnownCert_AddsMappingAndBroadcasts()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "floppy")).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "floppy"), Times.Once);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_WithKnownCert_RestoresActiveBrmbleName()
    {
        await _repo.Insert("abc123", "Alice");

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _activeSessions.Verify(s => s.TrackMumbleName("Alice", "abc123"), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_WithKnownActiveBrmbleCert_PersistsBrmbleStatusInMapping()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _activeSessions.Setup(s => s.IsBrmbleClient("abc123")).Returns(true);
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, It.IsAny<string>())).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryUpdateBrmbleStatus(1, true), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_WithKnownActiveBrmbleCert_StoresBrmbleStatusInSnapshot()
    {
        var user = await _repo.Insert("abc123", "Alice");
        var mapping = new SessionMappingService();
        _activeSessions.Setup(s => s.IsBrmbleClient("abc123")).Returns(true);
        var handler = new SessionMappingHandler(mapping, _bus.Object, _repo, _activeSessions.Object, NullLogger<SessionMappingHandler>.Instance);

        await handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        Assert.IsTrue(mapping.GetSnapshot()[1].IsBrmbleClient);
    }

    [TestMethod]
    public async Task OnUserConnected_EmptyCertHash_DoesNothing()
    {
        await _handler.OnUserConnected(new MumbleUser("Bob", "", 2));

        _mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<long>(), It.IsAny<string>()), Times.Never);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserConnected_UnknownCert_DoesNothing()
    {
        await _handler.OnUserConnected(new MumbleUser("Charlie", "unknown_hash", 3));

        _mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<long>(), It.IsAny<string>()), Times.Never);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserConnected_AlreadyMapped_BroadcastsRouteUpsert()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "floppy")).Returns(false);
        _mapping.Setup(m => m.TryUpdateBrmbleStatus(1, (bool?)null)).Returns(true);
        _mapping.Setup(m => m.TryUpdateCertHash(1, "abc123")).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "floppy"), Times.Once);
        // No socket has registered, so the status is unknown rather than a positive false.
        _mapping.Verify(m => m.TryUpdateBrmbleStatus(1, (bool?)null), Times.Once);
        _bus.Verify(b => b.BroadcastAsync(It.Is<object>(message =>
            message.GetType().GetProperty("type")!.GetValue(message)!.Equals("userMappingAdded") &&
            message.GetType().GetProperty("sessionId")!.GetValue(message)!.Equals(1) &&
            message.GetType().GetProperty("certHash")!.GetValue(message)!.Equals("abc123") &&
            message.GetType().GetProperty("isBrmbleClient")!.GetValue(message) == null)), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_AlreadyMappedActiveBrmbleCert_BroadcastsActivation()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _activeSessions.Setup(s => s.IsBrmbleClient("abc123")).Returns(true);
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "floppy")).Returns(false);
        _mapping.Setup(m => m.TryUpdateBrmbleStatus(1, true)).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryUpdateBrmbleStatus(1, true), Times.Once);
        _bus.Verify(b => b.BroadcastAsync(It.Is<object>(message =>
            message.GetType().GetProperty("type")!.GetValue(message)!.Equals("brmbleClientActivated") &&
            message.GetType().GetProperty("sessionId")!.GetValue(message)!.Equals(1))), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_BroadcastsCompanionId()
    {
        var user = await _repo.Insert("cert-a", "Alice");
        await _repo.SetCompanionId(user.Id, "engineer");
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "engineer")).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "cert-a", 1));

        _bus.Verify(b => b.BroadcastAsync(It.Is<object>(payload =>
            JsonSerializer.Serialize(payload).Contains("\"companionId\":\"engineer\""))), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_CustomCompanionUsesLegacySafeWireFields()
    {
        var user = await _repo.Insert("cert-custom", "Alice");
        using var connection = _keepAlive;
        await connection.ExecuteAsync(
            "UPDATE users SET companion_id = 'custom:$sprite:test' WHERE id = @Id", new { user.Id });
        var gallery = new CustomCompanionRepository(new Database(connection.ConnectionString));
        await gallery.InsertAsync(new CustomCompanionRecord(
            "$sprite:test", "sprite", "!gallery:test", user.Id, user.MatrixUserId, "Alice",
            "Orbit", "mxc://test/media", "image/png", 1, 1, 1, 1,
            DateTimeOffset.UtcNow, null, null));
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice", user.Id, "custom:$sprite:test")).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "cert-custom", 1));

        _bus.Verify(b => b.BroadcastAsync(It.Is<object>(payload =>
            JsonSerializer.Serialize(payload).Contains("\"companionId\":\"floppy\"") &&
            JsonSerializer.Serialize(payload).Contains("\"customCompanionId\":\"custom:$sprite:test\""))), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_PublishesUnknownBrmbleStatusWhenNoActiveSession()
    {
        // No WebSocket has registered for this cert, so IActiveBrmbleSessions returns false.
        // That is absence of evidence, not evidence of absence: it must go out as null.
        await _repo.Insert("cert-alice", "Alice");
        var broadcasts = new List<object>();
        _bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(broadcasts.Add)
            .Returns(Task.CompletedTask);

        await _handler.OnUserConnected(new MumbleUser("Alice", "cert-alice", 42));

        var payload = broadcasts.Single(p =>
            JsonSerializer.Serialize(p).Contains("\"type\":\"userMappingAdded\""));
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.AreEqual(JsonValueKind.Null,
            doc.RootElement.GetProperty("isBrmbleClient").ValueKind);
    }

    [TestMethod]
    public async Task OnUserConnected_PublishesTrueWhenSessionIsKnownActive()
    {
        await _repo.Insert("cert-alice", "Alice");
        _activeSessions.Setup(s => s.IsBrmbleClient("cert-alice")).Returns(true);
        var broadcasts = new List<object>();
        _bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(broadcasts.Add)
            .Returns(Task.CompletedTask);

        await _handler.OnUserConnected(new MumbleUser("Alice", "cert-alice", 42));

        var payload = broadcasts.Single(p =>
            JsonSerializer.Serialize(p).Contains("\"type\":\"userMappingAdded\""));
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.IsTrue(doc.RootElement.GetProperty("isBrmbleClient").GetBoolean());
    }
}
