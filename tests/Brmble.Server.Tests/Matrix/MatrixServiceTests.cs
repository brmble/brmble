using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixServiceTests
{
    private SqliteConnection? _keepAlive;
    private ChannelRepository _channelRepo = null!;
    private Mock<IMatrixAppService> _appService = null!;
    private Mock<IActiveBrmbleSessions> _sessions = null!;
    private MatrixService _svc = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        _channelRepo = new ChannelRepository(db);

        _appService = new Mock<IMatrixAppService>();
        _sessions = new Mock<IActiveBrmbleSessions>();
        _svc = new MatrixService(_channelRepo, _appService.Object, _sessions.Object, NullLogger<MatrixService>.Instance);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDependencies_DoesNotThrow()
    {
        var db = new Database("Data Source=:memory:");
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var svc = new MatrixService(channelRepo, appService, sessions, NullLogger<MatrixService>.Instance);
        Assert.IsNotNull(svc);
    }

    [TestMethod]
    public async Task RelayMessage_BrmbleClient_SkipsRelay()
    {
        _sessions.Setup(s => s.IsBrmbleClient("brmble-hash")).Returns(true);

        await _svc.RelayMessage(new MumbleUser("Alice", "brmble-hash", 1), "hello", 42);

        _appService.Verify(
            a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_UnmappedChannel_SkipsRelay()
    {
        _sessions.Setup(s => s.IsBrmbleClient(It.IsAny<string>())).Returns(false);
        // channel 99 not in DB

        await _svc.RelayMessage(new MumbleUser("Alice", "abc", 1), "hello", 99);

        _appService.Verify(
            a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_MappedChannel_PostsMessage()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(42, "!room:server");

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 2), "hello", 42);

        _appService.Verify(a => a.SendMessage("!room:server", "Bob", "hello"), Times.Once);
    }

    [TestMethod]
    public async Task RelayMessage_HtmlInText_StripsTagsBeforePosting()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        await _svc.RelayMessage(
            new MumbleUser("Bob", "og-hash", 1),
            "<b>bold</b> and <i>italic</i>",
            1);

        _appService.Verify(
            a => a.SendMessage("!room:server", "Bob", "bold and italic"),
            Times.Once);
    }

    [TestMethod]
    public async Task RelayMessage_HtmlEntitiesInText_DecodesEntities()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        await _svc.RelayMessage(
            new MumbleUser("Bob", "og-hash", 1),
            "hello &amp; world",
            1);

        _appService.Verify(
            a => a.SendMessage("!room:server", "Bob", "hello & world"),
            Times.Once);
    }

    [TestMethod]
    public async Task EnsureChannelRoom_NewChannel_CreatesRoomAndStoresMapping()
    {
        _appService.Setup(a => a.CreateRoom("General"))
            .ReturnsAsync("!newroom:server");

        await _svc.EnsureChannelRoom(new MumbleChannel(10, "General"));

        _appService.Verify(a => a.CreateRoom("General"), Times.Once);
        Assert.AreEqual("!newroom:server", await _channelRepo.GetRoomIdAsync(10));
    }

    [TestMethod]
    public async Task RelayMessage_Base64Image_UploadsAndSendsImageEvent()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        _appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"))
            .ReturnsAsync("mxc://server/uploaded123");

        var b64 = Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var msg = $"<img src=\"data:image/png;base64,{b64}\" />";

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

        _appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"), Times.Once);
        _appService.Verify(a => a.SendImageMessage("!room:server", "Bob", "mxc://server/uploaded123", "image.png", "image/png", 4), Times.Once);
        _appService.Verify(a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_Base64ImageWithText_SendsBothImageAndText()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        _appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"))
            .ReturnsAsync("mxc://server/uploaded123");

        var b64 = Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var msg = $"Check this out: <img src=\"data:image/png;base64,{b64}\" />";

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

        _appService.Verify(a => a.SendImageMessage("!room:server", "Bob", "mxc://server/uploaded123", "image.png", "image/png", 4), Times.Once);
        _appService.Verify(a => a.SendMessage("!room:server", "Bob", "Check this out:"), Times.Once);
    }

    [TestMethod]
    public async Task RelayMessage_Base64ImageOver5MB_SkipsImageSendsText()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        var bigData = new byte[6 * 1024 * 1024];
        var bigB64 = Convert.ToBase64String(bigData);
        var msg = $"<img src=\"data:image/png;base64,{bigB64}\" />";

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

        _appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _appService.Verify(a => a.SendImageMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()), Times.Never);
    }

    [TestMethod]
    public async Task EnsureChannelRoom_ExistingChannel_DoesNotCreateRoom()
    {
        await _channelRepo.InsertAsync(10, "!existing:server");

        await _svc.EnsureChannelRoom(new MumbleChannel(10, "General"));

        _appService.Verify(a => a.CreateRoom(It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task RelayMessage_UrlEncodedBase64Image_DecodesAndUploads()
    {
        _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
        await _channelRepo.InsertAsync(1, "!room:server");

        _appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/JPEG", "image.jpg"))
            .ReturnsAsync("mxc://server/uploaded456");

        var rawBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }; // JPEG header
        var rawB64 = Convert.ToBase64String(rawBytes);
        var urlEncoded = Uri.EscapeDataString(rawB64);
        var msg = $"<img src=\"data:image/JPEG;base64,{urlEncoded}\" />";

        await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

        _appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), "image/JPEG", "image.jpg"), Times.Once);
        _appService.Verify(a => a.SendImageMessage("!room:server", "Bob", "mxc://server/uploaded456", "image.jpg", "image/JPEG", 4), Times.Once);
    }
}
