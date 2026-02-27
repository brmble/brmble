using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class ChannelRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        Assert.IsNotNull(repo);
    }

    [TestMethod]
    public async Task GetRoomIdAsync_ExistingMapping_ReturnsRoomId()
    {
        var repo = new ChannelRepository(_db!);
        await repo.InsertAsync(42, "!room:server");

        var result = await repo.GetRoomIdAsync(42);

        Assert.AreEqual("!room:server", result);
    }

    [TestMethod]
    public async Task GetRoomIdAsync_UnknownChannel_ReturnsNull()
    {
        var repo = new ChannelRepository(_db!);

        var result = await repo.GetRoomIdAsync(99);

        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task InsertAsync_NewMapping_PersistsToDatabase()
    {
        var repo = new ChannelRepository(_db!);
        await repo.InsertAsync(1, "!abc:server");

        var result = await repo.GetRoomIdAsync(1);

        Assert.AreEqual("!abc:server", result);
    }

    [TestMethod]
    public async Task InsertAsync_DuplicateChannelId_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        await repo.InsertAsync(1, "!abc:server");
        await repo.InsertAsync(1, "!xyz:server"); // INSERT OR IGNORE — no throw
    }

    [TestMethod]
    public async Task DeleteAsync_ExistingMapping_RemovesRecord()
    {
        var repo = new ChannelRepository(_db!);
        await repo.InsertAsync(5, "!room:server");

        await repo.DeleteAsync(5);

        Assert.IsNull(await repo.GetRoomIdAsync(5));
    }

    [TestMethod]
    public async Task DeleteAsync_NonExistentMapping_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        await repo.DeleteAsync(999);
    }

    [TestMethod]
    public async Task GetAllAsync_ReturnsAllMappings()
    {
        var repo = new ChannelRepository(_db!);
        await repo.InsertAsync(1, "!room1:server");
        await repo.InsertAsync(2, "!room2:server");

        var all = await repo.GetAllAsync();

        Assert.AreEqual(2, all.Count);
        Assert.IsTrue(all.Any(m => m.MumbleChannelId == 1 && m.MatrixRoomId == "!room1:server"));
        Assert.IsTrue(all.Any(m => m.MumbleChannelId == 2 && m.MatrixRoomId == "!room2:server"));
    }

    [TestMethod]
    public async Task GetAllAsync_Empty_ReturnsEmptyList()
    {
        var repo = new ChannelRepository(_db!);
        Assert.AreEqual(0, (await repo.GetAllAsync()).Count);
    }
}
