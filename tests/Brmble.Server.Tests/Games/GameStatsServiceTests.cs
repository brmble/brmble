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

    [TestMethod]
    public async Task HeadToHead_AggregatesAcrossGames_FromSelfPerspective()
    {
        var db = NewDb();
        var repo = new GameRepository(db);
        var stats = new GameStatsService(db);
        var now = DateTimeOffset.UtcNow;

        // deathroll: 10 beats 20
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now, now.AddSeconds(10),
            new[] { new CompletedParticipant(10, 1, 3, "win"), new CompletedParticipant(20, 2, 1, "loss") }));
        // deathroll: 20 beats 10
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now, now.AddSeconds(10),
            new[] { new CompletedParticipant(10, 2, 1, "loss"), new CompletedParticipant(20, 1, 5, "win") }));
        // rps: 10 beats 20
        await repo.SaveCompletedMatchAsync(new CompletedMatch("rps", 1, "bo3", "decided", null,
            now, now.AddSeconds(10),
            new[] { new CompletedParticipant(10, 1, 2, "win"), new CompletedParticipant(20, 2, 0, "loss") }));

        // From 10's perspective: 2 wins (1 deathroll + 1 rps), 1 loss.
        var self10 = await stats.GetHeadToHeadAsync(10, 20);
        Assert.AreEqual(2, self10.Wins);
        Assert.AreEqual(1, self10.Losses);
        Assert.AreEqual(0, self10.Draws);
        Assert.AreEqual(2, self10.Games.Count);
        var dr10 = self10.Games.Single(g => g.GameType == "deathroll");
        Assert.AreEqual(1, dr10.Wins);
        Assert.AreEqual(1, dr10.Losses);
        var rps10 = self10.Games.Single(g => g.GameType == "rps");
        Assert.AreEqual(1, rps10.Wins);
        Assert.AreEqual(0, rps10.Losses);

        // From 20's perspective the record is mirrored: 1 win, 2 losses.
        var self20 = await stats.GetHeadToHeadAsync(20, 10);
        Assert.AreEqual(1, self20.Wins);
        Assert.AreEqual(2, self20.Losses);
    }

    [TestMethod]
    public async Task HeadToHead_NoMatches_ReturnsEmpty()
    {
        var db = NewDb();
        var stats = new GameStatsService(db);

        var h2h = await stats.GetHeadToHeadAsync(88, 99);

        Assert.AreEqual(0, h2h.Wins);
        Assert.AreEqual(0, h2h.Losses);
        Assert.AreEqual(0, h2h.Draws);
        Assert.AreEqual(0, h2h.GamesPlayed);
        Assert.AreEqual(0, h2h.Games.Count);
    }
}
