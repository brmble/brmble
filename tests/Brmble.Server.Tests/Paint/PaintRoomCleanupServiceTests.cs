using System.Text.Json;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.Extensions.Logging;
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
    public async Task ProcessPending_LogsSafeContextForFailedCleanupResult()
    {
        const string rawMatrixResponse = "{\"errcode\":\"M_FORBIDDEN\",\"error\":\"access token secret\"}";
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!room:test");
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(false, "admin-delete", rawMatrixResponse));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        var entry = fixture.Logger.Entries.Single();
        Assert.AreEqual(LogLevel.Warning, entry.Level);
        Assert.AreEqual(fixture.SessionId, entry.Properties["SessionId"]);
        Assert.AreEqual("!room:test", entry.Properties["RoomId"]);
        Assert.AreEqual("admin-delete", entry.Properties["Mode"]);
        Assert.AreEqual(1, entry.Properties["Attempt"]);
        Assert.AreEqual("MATRIX_ROOM_DELETE_FAILED", entry.Properties["FailureType"]);
        Assert.IsFalse(entry.Message.Contains(rawMatrixResponse, StringComparison.Ordinal));
        Assert.IsFalse(entry.Properties.Values.OfType<string>().Any(value => value.Contains(rawMatrixResponse, StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task ProcessPending_LogsSafeContextForCleanupException()
    {
        const string rawExceptionMessage = "Matrix returned: {\"access_token\":\"secret\"}";
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!room:test");
        fixture.Matrix.ExceptionToThrow = new InvalidOperationException(rawExceptionMessage);

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        var entry = fixture.Logger.Entries.Single();
        Assert.AreEqual(LogLevel.Warning, entry.Level);
        Assert.AreEqual(fixture.SessionId, entry.Properties["SessionId"]);
        Assert.AreEqual("!room:test", entry.Properties["RoomId"]);
        Assert.AreEqual("exception", entry.Properties["Mode"]);
        Assert.AreEqual(1, entry.Properties["Attempt"]);
        Assert.AreEqual(nameof(InvalidOperationException), entry.Properties["FailureType"]);
        Assert.IsFalse(entry.Message.Contains(rawExceptionMessage, StringComparison.Ordinal));
        Assert.IsFalse(entry.Properties.Values.OfType<string>().Any(value => value.Contains(rawExceptionMessage, StringComparison.Ordinal)));
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

    [TestMethod]
    public async Task ProcessPending_ContinuesAfterRepositoryReadFailure()
    {
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        fixture.DropCleanupTable();

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        fixture.Database.Initialize();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!room:test");
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(true, "admin-delete", null));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(1, fixture.Matrix.DeleteCalls);
        Assert.AreEqual(0, (await fixture.Repository.GetPendingAsync()).Count);
    }

    [TestMethod]
    public async Task ProcessPending_ContinuesAfterRecordStateWriteFailure()
    {
        var fixture = await PaintRoomCleanupFixture.NewAsync();
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!first:test");
        await fixture.Repository.RecordPendingAsync(fixture.SessionId, "!second:test");
        var first = (await fixture.Repository.GetPendingAsync()).Single(record => record.MatrixRoomId == "!first:test");
        fixture.RejectFailureUpdate(first.Id);
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(false, "admin-delete", "MATRIX_ROOM_DELETE_FAILED"));
        fixture.Matrix.Results.Enqueue(new MatrixPaintRoomCleanupResult(true, "admin-delete", null));

        await fixture.Service.ProcessPendingAsync(CancellationToken.None);

        Assert.AreEqual(2, fixture.Matrix.DeleteCalls);
        var pending = (await fixture.Repository.GetPendingAsync()).Single();
        Assert.AreEqual("!first:test", pending.MatrixRoomId);
    }

    private sealed class PaintRoomCleanupFixture
    {
        public Guid SessionId { get; init; }
        public required Database Database { get; init; }
        public required PaintRoomCleanupRepository Repository { get; init; }
        public required FakeMatrixPaintService Matrix { get; init; }
        public required CapturingLogger<PaintRoomCleanupService> Logger { get; init; }
        public required PaintRoomCleanupService Service { get; init; }

        public static async Task<PaintRoomCleanupFixture> NewAsync(bool recordBeforeServiceConstruction = false)
        {
            var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-service-{Guid.NewGuid():N}.db");
            var database = new Database($"Data Source={path}");
            database.Initialize();
            var repository = new PaintRoomCleanupRepository(database);
            var matrix = new FakeMatrixPaintService();
            var logger = new CapturingLogger<PaintRoomCleanupService>();
            var sessionId = Guid.NewGuid();

            if (recordBeforeServiceConstruction)
            {
                await repository.RecordPendingAsync(sessionId, "!room:test");
            }

            return new PaintRoomCleanupFixture
            {
                Database = database,
                Repository = repository,
                Matrix = matrix,
                Logger = logger,
                Service = new PaintRoomCleanupService(repository, matrix, logger),
                SessionId = sessionId,
            };
        }

        public void DropCleanupTable() => Execute("DROP TABLE paint_room_cleanup");

        public void RejectFailureUpdate(long recordId) => Execute($"""
            CREATE TRIGGER reject_cleanup_update
            BEFORE UPDATE ON paint_room_cleanup
            WHEN OLD.id = {recordId}
            BEGIN
                SELECT RAISE(ABORT, 'state write unavailable');
            END
            """);

        private void Execute(string sql)
        {
            using var connection = Database.CreateConnection();
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.ExecuteNonQuery();
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<LogEntry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var properties = state is IEnumerable<KeyValuePair<string, object?>> values
                ? values.ToDictionary(value => value.Key, value => value.Value)
                : [];
            Entries.Add(new LogEntry(logLevel, properties, formatter(state, exception)));
        }
    }

    private sealed record LogEntry(LogLevel Level, IReadOnlyDictionary<string, object?> Properties, string Message);

    private sealed class FakeMatrixPaintService : IMatrixPaintService
    {
        public Queue<MatrixPaintRoomCleanupResult> Results { get; } = [];
        public List<string> DeletedRoomIds { get; } = [];
        public int DeleteCalls { get; private set; }
        public Exception? ExceptionToThrow { get; set; }

        public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken)
        {
            DeleteCalls++;
            DeletedRoomIds.Add(roomId);
            if (ExceptionToThrow is not null) throw ExceptionToThrow;
            return Task.FromResult(Results.Dequeue());
        }
    }
}
