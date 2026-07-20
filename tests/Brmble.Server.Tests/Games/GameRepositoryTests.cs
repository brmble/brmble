using Brmble.Server.Data;
using Brmble.Server.Games;
using Dapper;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class GameRepositoryTests
{
    private static Database NewDb()
    {
        // Shared in-memory DB kept alive by an open connection is complex with Dapper here;
        // use a temp file DB for isolation.
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return db;
    }

    [TestMethod]
    public async Task SaveCompletedMatch_WritesMatchParticipantsAndAggregates()
    {
        var db = NewDb();
        var repo = new GameRepository(db);
        var now = DateTimeOffset.UtcNow;

        var completed = new CompletedMatch(
            GameType: "deathroll",
            ChannelId: 5,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: now,
            EndedAt: now.AddSeconds(30),
            Participants: new[]
            {
                new CompletedParticipant(UserId: 10, Placement: 1, Score: 4, Result: "win"),
                new CompletedParticipant(UserId: 20, Placement: 2, Score: 1, Result: "loss"),
            });

        var matchId = await repo.SaveCompletedMatchAsync(completed);
        Assert.IsTrue(matchId > 0);

        var winnerStats = await repo.GetUserStatsAsync(10, "deathroll");
        Assert.AreEqual(1, winnerStats.Wins);
        Assert.AreEqual(0, winnerStats.Losses);
        Assert.AreEqual(1, winnerStats.GamesPlayed);

        var loserStats = await repo.GetUserStatsAsync(20, "deathroll");
        Assert.AreEqual(1, loserStats.Losses);

        using var conn = db.CreateConnection();
        var h2h = conn.QuerySingle<(int low_wins, int high_wins, int draws)>(
            "SELECT low_wins, high_wins, draws FROM game_head_to_head WHERE player_low_id=10 AND player_high_id=20 AND game_type='deathroll'");
        Assert.AreEqual(1, h2h.low_wins);
        Assert.AreEqual(0, h2h.high_wins);
    }

    [TestMethod]
    public async Task SaveCompletedMatch_PersistsMetadataJson_RoundTrips()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var match = new CompletedMatch(
            GameType: "deathroll",
            ChannelId: 7,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            EndedAt: DateTimeOffset.UtcNow,
            Participants: new[]
            {
                new CompletedParticipant(10, 1, null, "win",
                    MetadataJson: "{\"schemaVersion\":1,\"displayName\":\"Alice\"}"),
                new CompletedParticipant(20, 2, 1, "loss",
                    MetadataJson: "{\"schemaVersion\":1,\"displayName\":\"Bob\"}"),
            },
            MetadataJson: "{\"schemaVersion\":1,\"summary\":{\"totalRolls\":3}}");

        var matchId = await repo.SaveCompletedMatchAsync(match);

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches WHERE id = @matchId", new { matchId });
        Assert.IsTrue(matchMeta.Contains("\"totalRolls\":3"));

        var aliceMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_match_participants WHERE match_id = @matchId AND user_id = 10",
            new { matchId });
        Assert.IsTrue(aliceMeta.Contains("Alice"));
    }
}
