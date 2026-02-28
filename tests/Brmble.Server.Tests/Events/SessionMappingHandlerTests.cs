using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class SessionMappingHandlerTests
{
    private SqliteConnection _keepAlive = null!;
    private UserRepository _repo = null!;
    private Mock<ISessionMappingService> _mapping = null!;
    private Mock<IBrmbleEventBus> _bus = null!;
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
        _handler = new SessionMappingHandler(_mapping.Object, _bus.Object, _repo, NullLogger<SessionMappingHandler>.Instance);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task OnUserConnected_WithKnownCert_AddsMappingAndBroadcasts()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice")).Returns(true);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice"), Times.Once);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_EmptyCertHash_DoesNothing()
    {
        await _handler.OnUserConnected(new MumbleUser("Bob", "", 2));

        _mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserConnected_UnknownCert_DoesNothing()
    {
        await _handler.OnUserConnected(new MumbleUser("Charlie", "unknown_hash", 3));

        _mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserConnected_AlreadyMapped_DoesNotBroadcast()
    {
        var user = await _repo.Insert("abc123", "Alice");
        _mapping.Setup(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice")).Returns(false);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        _mapping.Verify(m => m.TryAddMatrixUser(1, user.MatrixUserId, "Alice"), Times.Once);
        _bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }
}
