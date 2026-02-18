using Brmble.Server.Data;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Data;

[TestClass]
public class DatabaseTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;

    [TestInitialize]
    public void Setup()
    {
        // Named shared-cache in-memory DB: persists as long as _keepAlive is open
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
    }

    [TestCleanup]
    public void Cleanup()
    {
        _keepAlive?.Dispose(); // releasing last connection drops the in-memory DB
    }

    [TestMethod]
    public void Initialize_CreatesUsersTable()
    {
        _db!.Initialize();

        using var conn = _db.CreateConnection();
        conn.Open();
        var count = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'");

        Assert.AreEqual(1, count);
    }

    [TestMethod]
    public void Initialize_CreatesChannelRoomMapTable()
    {
        _db!.Initialize();

        using var conn = _db.CreateConnection();
        conn.Open();
        var count = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='channel_room_map'");

        Assert.AreEqual(1, count);
    }

    [TestMethod]
    public void Initialize_IsIdempotent()
    {
        _db!.Initialize();
        // CREATE TABLE IF NOT EXISTS — second call must not throw
        _db.Initialize();
    }

    [TestMethod]
    public void CreateConnection_ReturnsOpenableConnection()
    {
        using var conn = _db!.CreateConnection();
        conn.Open();
        Assert.AreEqual(System.Data.ConnectionState.Open, conn.State);
    }
}
