using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
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
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var channelRepo = new ChannelRepository(db);
        await channelRepo.InsertAsync(1, "!room:server");

        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        sessions.Setup(s => s.IsBrmbleClient("og")).Returns(false);

        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

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
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        await _handler.OnChannelCreated(new MumbleChannel(99, "Test"));

        appService.Verify(a => a.CreateRoom("Test"), Times.Once);
    }

    [TestMethod]
    public async Task OnChannelRemoved_DeletesMapping()
    {
        var appService = new Mock<IMatrixAppService>();
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var channelRepo = new ChannelRepository(db);
        await channelRepo.InsertAsync(5, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        await _handler.OnChannelRemoved(new MumbleChannel(5, "OldChannel"));

        Assert.IsNull(await channelRepo.GetRoomIdAsync(5));
    }

    [TestMethod]
    public async Task OnChannelRenamed_CallsSetRoomName()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.SetRoomName(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var channelRepo = new ChannelRepository(db);
        await channelRepo.InsertAsync(3, "!room:server");
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        await _handler.OnChannelRenamed(new MumbleChannel(3, "NewName"));

        appService.Verify(a => a.SetRoomName("!room:server", "NewName"), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_DoesNotThrow()
    {
        var appService = new Mock<IMatrixAppService>();
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(
            new ChannelRepository(db),
            appService.Object,
            sessions.Object,
            NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        await _handler.OnUserConnected(new MumbleUser("Alice", "abc", 1));
    }

    [TestMethod]
    public async Task OnUserDisconnected_DoesNotThrow()
    {
        var appService = new Mock<IMatrixAppService>();
        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var sessions = new Mock<Brmble.Server.Auth.IActiveBrmbleSessions>();
        var svc = new MatrixService(
            new ChannelRepository(db),
            appService.Object,
            sessions.Object,
            NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        await _handler.OnUserDisconnected(new MumbleUser("Alice", "abc", 1));
    }

    [TestMethod]
    public async Task OnUserTextureAvailable_UploadsAndSetsAvatar_WhenNoExistingBrmbleAvatar()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "avatar.png"))
            .ReturnsAsync("mxc://server/texture123");
        appService.Setup(a => a.SetAvatarUrl(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var user = await userRepo.Insert("abc", "Alice");

        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        // PNG magic bytes
        var texture = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        await _handler.OnUserTextureAvailable(new MumbleUser("Alice", "abc", 1), texture);

        appService.Verify(a => a.UploadMedia(texture, "image/png", "avatar.png"), Times.Once);
        appService.Verify(a => a.SetAvatarUrl(It.IsAny<string>(), "mxc://server/texture123"), Times.Once);
        Assert.AreEqual("mumble", await userRepo.GetAvatarSource(user.Id));
    }

    [TestMethod]
    public async Task OnUserTextureAvailable_SkipsWhenBrmbleAvatarExists()
    {
        var appService = new Mock<IMatrixAppService>();

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var user = await userRepo.Insert("def", "Bob");
        await userRepo.SetAvatarSource(user.Id, "brmble");

        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        var texture = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        await _handler.OnUserTextureAvailable(new MumbleUser("Bob", "def", 2), texture);

        appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserTextureAvailable_SkipsUploadWhenTextureHashUnchanged()
    {
        var appService = new Mock<IMatrixAppService>();
        appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "avatar.png"))
            .ReturnsAsync("mxc://server/texture123");
        appService.Setup(a => a.SetAvatarUrl(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var (db, keepAlive) = CreateDb();
        using var _ = keepAlive;
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        var userRepo = new UserRepository(db, settings);
        var user = await userRepo.Insert("ghi", "Carol");

        var channelRepo = new ChannelRepository(db);
        var sessions = new Mock<IActiveBrmbleSessions>();
        var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
        _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

        // PNG magic bytes
        var texture = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

        // First call should upload
        await _handler.OnUserTextureAvailable(new MumbleUser("Carol", "ghi", 3), texture);
        appService.Verify(a => a.UploadMedia(texture, "image/png", "avatar.png"), Times.Once);

        // Second call with same texture should skip
        await _handler.OnUserTextureAvailable(new MumbleUser("Carol", "ghi", 3), texture);
        appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }
}
