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
    public void GetRoomId_ExistingMapping_ReturnsRoomId()
    {
        var repo = new ChannelRepository(_db!);
        repo.Insert(42, "!room:server");

        var result = repo.GetRoomId(42);

        Assert.AreEqual("!room:server", result);
    }

    [TestMethod]
    public void GetRoomId_UnknownChannel_ReturnsNull()
    {
        var repo = new ChannelRepository(_db!);

        var result = repo.GetRoomId(99);

        Assert.IsNull(result);
    }

    [TestMethod]
    public void Insert_NewMapping_PersistsToDatabase()
    {
        var repo = new ChannelRepository(_db!);
        repo.Insert(1, "!abc:server");

        var result = repo.GetRoomId(1);

        Assert.AreEqual("!abc:server", result);
    }

    [TestMethod]
    public void Insert_DuplicateChannelId_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        repo.Insert(1, "!abc:server");
        repo.Insert(1, "!xyz:server"); // INSERT OR IGNORE — no throw
    }

    [TestMethod]
    public void Delete_ExistingMapping_RemovesRecord()
    {
        var repo = new ChannelRepository(_db!);
        repo.Insert(5, "!room:server");

        repo.Delete(5);

        Assert.IsNull(repo.GetRoomId(5));
    }

    [TestMethod]
    public void Delete_NonExistentMapping_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        repo.Delete(999);
    }
}
