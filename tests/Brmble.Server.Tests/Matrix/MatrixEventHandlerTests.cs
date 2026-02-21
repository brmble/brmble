using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixEventHandlerTests
{
    private MatrixEventHandler _handler = null!;

    private static (Database db, SqliteConnection keepAlive) CreateDb()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        var keepAlive = new SqliteConnection(cs);
        keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        return (db, keepAlive);
    }

    [TestMethod]
    public async Task OnUserTextMessage_CallsRelayMessage()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(1, "!room:server");

        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        sessions.Setup(s => s.IsBrmbleClient("og")).Returns(false);

        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserTextMessage(new MumbleUser("Bob", "og", 1), "hi", 1);

        appService.Verify(a => a.SendMessage("!room:server", "Bob", "hi"), Times.Once);
    }

    [TestMethod]
    public async Task OnChannelCreated_CallsEnsureChannelRoom()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.CreateRoom("Test")).ReturnsAsync("!newroom:server");

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelCreated(new MumbleChannel(99, "Test"));

        appService.Verify(a => a.CreateRoom("Test"), Times.Once);
    }

    [TestMethod]
    public async Task OnChannelRemoved_DeletesMapping()
    {
        var appService = new Mock<IMatrixAppService>();
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(5, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelRemoved(new MumbleChannel(5, "OldChannel"));

        Assert.IsNull(channelRepo.GetRoomId(5));
    }

    [TestMethod]
    public async Task OnChannelRenamed_CallsSetRoomName()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.SetRoomName(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var channelRepo = new ChannelRepository(db);
        channelRepo.Insert(3, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnChannelRenamed(new MumbleChannel(3, "NewName"));

        appService.Verify(a => a.SetRoomName("!room:server", "NewName"), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_DoesNotThrow()
    {
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var svc = new MatrixService(
            new ChannelRepository(db),
            new Mock<IMatrixAppService>().Object,
            new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>().Object,
            NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc", 1));
    }

    [TestMethod]
    public async Task OnUserDisconnected_DoesNotThrow()
    {
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var svc = new MatrixService(
            new ChannelRepository(db),
            new Mock<IMatrixAppService>().Object,
            new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>().Object,
            NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc);

        await _handler.OnUserDisconnected(new MumbleUser("Alice", "abc", 1));
    }
}
