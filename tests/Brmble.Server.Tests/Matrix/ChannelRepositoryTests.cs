using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class ChannelRepositoryTests
{
    // TODO: Add tests as methods are implemented in ChannelRepository:
    // - GetRoomId_ExistingMapping_ReturnsRoomId
    // - GetRoomId_UnknownChannel_ReturnsNull
    // - Insert_NewMapping_PersistsToDatabase
    // - Delete_ExistingMapping_RemovesRecord

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
}
