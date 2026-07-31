using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintRoomCleanupRepositoryTests
{
    [TestMethod]
    public async Task RecordPendingAsync_HidesTheRecordFromTheSweeperDuringTheGracePeriod()
    {
        // The record is written before the session's terminal transition, so the sweeper must not
        // be able to delete the Matrix room until the caller has had a chance to compensate.
        var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var repository = new PaintRoomCleanupRepository(database);
        var sessionId = Guid.NewGuid();

        await repository.RecordPendingAsync(sessionId, "!paint:test");

        Assert.AreEqual(0, (await repository.GetPendingAsync()).Count);

        await repository.DeletePendingAsync(sessionId, "!paint:test");
        Assert.AreEqual(0, (await repository.GetPendingAsync()).Count);
    }

    [TestMethod]
    public async Task PendingRecords_CanBeMarkedFailedAndThenSucceeded()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var repository = new PaintRoomCleanupRepository(database, TimeSpan.Zero);
        var sessionId = Guid.NewGuid();

        await repository.RecordPendingAsync(sessionId, "!paint:test");
        var pending = await repository.GetPendingAsync();
        await repository.MarkFailedAsync(pending.Single().Id, "unavailable");
        await repository.MarkSucceededAsync(pending.Single().Id);

        Assert.AreEqual(0, (await repository.GetPendingAsync()).Count);
    }

    [TestMethod]
    public async Task RecordPendingAsync_DeduplicatesCleanupRecordsForTheSameRoom()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var repository = new PaintRoomCleanupRepository(database, TimeSpan.Zero);

        await repository.RecordPendingAsync(Guid.NewGuid(), "!paint:test");
        await repository.RecordPendingAsync(Guid.NewGuid(), "!paint:test");

        Assert.AreEqual(1, (await repository.GetPendingAsync()).Count);
    }

    [TestMethod]
    public async Task MarkFailedAsync_SchedulesTheNextAttemptInsteadOfRetryingImmediately()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var repository = new PaintRoomCleanupRepository(database, TimeSpan.Zero);

        await repository.RecordPendingAsync(Guid.NewGuid(), "!paint:test");
        var pending = (await repository.GetPendingAsync()).Single();
        await repository.MarkFailedAsync(pending.Id, "unavailable");

        Assert.AreEqual(0, (await repository.GetPendingAsync()).Count);
    }
}
