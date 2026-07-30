using Brmble.Server.Companions;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionGalleryServiceTests
{
    private SqliteConnection? _keepAlive;
    private Mock<IMatrixAppService> _matrix = null!;
    private CustomCompanionGalleryService _service = null!;

    [TestInitialize]
    public void Setup()
    {
        var databaseName = "testdb_" + Guid.NewGuid().ToString("N");
        var connectionString = $"Data Source={databaseName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(connectionString);
        _keepAlive.Open();
        var database = new Database(connectionString);
        database.Initialize();
        _matrix = new Mock<IMatrixAppService>();
        _matrix.Setup(service => service.CreateCustomCompanionGalleryRoom())
            .ReturnsAsync("!gallery:test");
        _service = new CustomCompanionGalleryService(new CustomCompanionRepository(database), _matrix.Object);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task GetOrCreateRoom_ConcurrentCallsCreateExactlyOneRoom()
    {
        var calls = Enumerable.Range(0, 8)
            .Select(_ => _service.GetOrCreateRoomIdAsync(CancellationToken.None));

        var roomIds = await Task.WhenAll(calls);

        Assert.AreEqual(1, roomIds.Distinct().Count());
        _matrix.Verify(service => service.CreateCustomCompanionGalleryRoom(), Times.Once);
    }
}
