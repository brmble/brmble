using Brmble.Server.Data;
using Brmble.Server.Games;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class GameStatsServiceTests
{
    private static Database NewDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return db;
    }

    [TestMethod]
    public async Task WindowedStats_CountsOnlyMatchesInRange()
    {
        var db = NewDb();
        var repo = new GameRepository(db);
        var stats = new GameStatsService(db);
        var now = DateTimeOffset.UtcNow;

        // Old match (40 days ago) — user 10 wins
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now.AddDays(-40), now.AddDays(-40).AddSeconds(10),
            new[] { new CompletedParticipant(10, 1, 3, "win"), new CompletedParticipant(20, 2, 1, "loss") }));

        // Recent match (2 days ago) — user 10 loses
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now.AddDays(-2), now.AddDays(-2).AddSeconds(10),
            new[] { new CompletedParticipant(10, 2, 1, "loss"), new CompletedParticipant(20, 1, 5, "win") }));

        var week = await stats.GetWindowedStatsAsync(10, "deathroll", now.AddDays(-7), now);
        Assert.AreEqual(0, week.Wins);
        Assert.AreEqual(1, week.Losses);

        var all = await stats.GetWindowedStatsAsync(10, "deathroll", now.AddDays(-365), now);
        Assert.AreEqual(1, all.Wins);
        Assert.AreEqual(1, all.Losses);
    }
}
