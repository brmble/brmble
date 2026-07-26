using System.Text.Json;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintRoomCleanupServiceTests
{
    [TestMethod]
    public async Task ProcessPending_RemovesSuccessfulCleanupRecord()
    {
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!room:test");
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(true, "admin-delete", null));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(1, fixture.Matrix.DeleteCalls);
        CollectionAssert.AreEqual(new[] { "!room:test" }, fixture.Matrix.DeletedRoomIds);
        Assert.AreEqual(0, (await fixture.Repository.GetPendingAsync()).Count);
    }

    [TestMethod]
    public async Task ProcessPending_RetainsFailedCleanupRecordWithAttemptAndError()
    {
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!room:test");
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(false, "failed", "MATRIX_ROOM_DELETE_FAILED"));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        var pending = (await fixture.Repository.GetPendingAsync()).Single();
        Assert.AreEqual(1, fixture.Matrix.DeleteCalls);
        CollectionAssert.AreEqual(new[] { "!room:test" }, fixture.Matrix.DeletedRoomIds);
        Assert.AreEqual(1, pending.Attempts);
        Assert.AreEqual("MATRIX_ROOM_DELETE_FAILED", pending.LastError);
    }

    [TestMethod]
    public async Task ProcessPending_HandlesRecordPersistedBeforeServiceConstruction()
    {
        var fixture = await PaintRoomCleanupFixture.NewAsync(recordBeforeServiceConstruction: true);
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(true, "admin-delete", null));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(1, fixture.Matrix.DeleteCalls);
        CollectionAssert.AreEqual(new[] { "!room:test" }, fixture.Matrix.DeletedRoomIds);
        Assert.AreEqual(0, (await fixture.Repository.GetPendingAsync()).Count);
    }

    private sealed class PaintRoomCleanupFixture
    {
        public Guid SessionId { get; init; }
        public required PaintRoomCleanupRepository Repository { get; init; }
        public required FakeMatrixPaintService Matrix { get; init; }
        public required PaintRoomCleanupService Service { get; init; }

        public static async Task<PaintRoomCleanupFixture> NewAsync(bool recordBeforeServiceConstruction = false)
        {
            var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-service-{Guid.NewGuid():N}.db");
            var database = new Database($"Data Source={path}");
            database.Initialize();
            var repository = new PaintRoomCleanupRepository(database);
            var matrix = new FakeMatrixPaintService();
            var sessionId = Guid.NewGuid();

            if (recordBeforeServiceConstruction)
            {
                await repository.RecordPendingAsync(sessionId, "!room:test");
            }

            return new PaintRoomCleanupFixture
            {
                Repository = repository,
                Matrix = matrix,
                Service = new PaintRoomCleanupService(repository, matrix),
                SessionId = sessionId,
            };
        }
    }

    private sealed class FakeMatrixPaintService : IMatrixPaintService
    {
        public Queue<MatrixPaintRoomCleanupResult> Results { get; } = [];
        public List<string> DeletedRoomIds { get; } = [];
        public int DeleteCalls { get; private set; }

        public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken)
        {
            DeleteCalls++;
            DeletedRoomIds.Add(roomId);
            return Task.FromResult(Results.Dequeue());
        }
    }
}
