using Brmble.Server.Data;
using Brmble.Server.DM;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.DM;

[TestClass]
public class DmRoomRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private DmRoomRepository _repo = null!;
    private Database _db = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _repo = new DmRoomRepository(_db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task GetRoomIdAsync_NoMapping_ReturnsNull()
    {
        var result = await _repo.GetRoomIdAsync(1, 2);
        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task InsertAndGetRoomIdAsync_ReturnsStoredRoom()
    {
        await _repo.InsertAsync(1, 2, "!room:server");
        var result = await _repo.GetRoomIdAsync(1, 2);
        Assert.AreEqual("!room:server", result);
    }

    [TestMethod]
    public async Task InsertAsync_Idempotent_DoesNotThrow()
    {
        await _repo.InsertAsync(1, 2, "!room:server");
        // INSERT OR IGNORE should not throw on duplicate
        await _repo.InsertAsync(1, 2, "!room:server");
        var result = await _repo.GetRoomIdAsync(1, 2);
        Assert.AreEqual("!room:server", result);
    }

    [TestMethod]
    public async Task GetAllForUserAsync_ReturnsRoomsForUser()
    {
        // Set up users table
        using var conn = _db.CreateConnection();
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO users (id, cert_hash, display_name, matrix_user_id) VALUES (1, 'hash1', 'Alice', '@1:server');
            INSERT INTO users (id, cert_hash, display_name, matrix_user_id) VALUES (2, 'hash2', 'Bob', '@2:server');
            INSERT INTO users (id, cert_hash, display_name, matrix_user_id) VALUES (3, 'hash3', 'Charlie', '@3:server');
        """;
        cmd.ExecuteNonQuery();

        // User 1 has DMs with user 2 and user 3
        await _repo.InsertAsync(1, 2, "!dm12:server");
        await _repo.InsertAsync(1, 3, "!dm13:server");
        // User 2 also has a DM with user 3
        await _repo.InsertAsync(2, 3, "!dm23:server");

        // Query for user 1: should see rooms with user 2 and user 3
        var roomsForUser1 = await _repo.GetAllForUserAsync(1);
        Assert.AreEqual(2, roomsForUser1.Count);
        Assert.IsTrue(roomsForUser1.Any(r => r.OtherMatrixUserId == "@2:server" && r.MatrixRoomId == "!dm12:server"));
        Assert.IsTrue(roomsForUser1.Any(r => r.OtherMatrixUserId == "@3:server" && r.MatrixRoomId == "!dm13:server"));

        // Query for user 2: should see rooms with user 1 and user 3
        var roomsForUser2 = await _repo.GetAllForUserAsync(2);
        Assert.AreEqual(2, roomsForUser2.Count);
        Assert.IsTrue(roomsForUser2.Any(r => r.OtherMatrixUserId == "@1:server" && r.MatrixRoomId == "!dm12:server"));
        Assert.IsTrue(roomsForUser2.Any(r => r.OtherMatrixUserId == "@3:server" && r.MatrixRoomId == "!dm23:server"));

        // Query for user 3: should see rooms with user 1 and user 2
        var roomsForUser3 = await _repo.GetAllForUserAsync(3);
        Assert.AreEqual(2, roomsForUser3.Count);
        Assert.IsTrue(roomsForUser3.Any(r => r.OtherMatrixUserId == "@1:server" && r.MatrixRoomId == "!dm13:server"));
        Assert.IsTrue(roomsForUser3.Any(r => r.OtherMatrixUserId == "@2:server" && r.MatrixRoomId == "!dm23:server"));
    }

    [TestMethod]
    public async Task GetAllForUserAsync_NoRooms_ReturnsEmptyList()
    {
        var result = await _repo.GetAllForUserAsync(999);
        Assert.AreEqual(0, result.Count);
    }
}
