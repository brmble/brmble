using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintRoomCleanupRepositoryTests
{
    [TestMethod]
    public async Task PendingRecords_CanBeMarkedFailedAndThenSucceeded()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-cleanup-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var repository = new PaintRoomCleanupRepository(database);
        var sessionId = Guid.NewGuid();

        await repository.RecordPendingAsync(sessionId, "!paint:test");
        var pending = await repository.GetPendingAsync();
        await repository.MarkFailedAsync(pending.Single().Id, "unavailable");
        var failed = (await repository.GetPendingAsync()).Single();
        await repository.MarkSucceededAsync(failed.Id);

        Assert.AreEqual(1, failed.Attempts);
        Assert.AreEqual("unavailable", failed.LastError);
        Assert.AreEqual(0, (await repository.GetPendingAsync()).Count);
    }
}
