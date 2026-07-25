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
    public void Initialize_MigratesRulesetVersionAndCreatesDurationIndex()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        using (var conn = db.CreateConnection())
        {
            conn.Execute("""
                CREATE TABLE game_matches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_type TEXT NOT NULL,
                    channel_id INTEGER NOT NULL,
                    format TEXT NOT NULL DEFAULT '1v1',
                    outcome TEXT NOT NULL,
                    abandon_reason TEXT,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    metadata_json TEXT
                );
                INSERT INTO game_matches
                    (game_type, channel_id, format, outcome, started_at, ended_at, duration_ms)
                VALUES ('rps', 1, 'bo3', 'decided', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', 1000);
                """);
        }

        db.Initialize();
        db.Initialize();

        using var migrated = db.CreateConnection();
        var rulesetColumn = migrated.QuerySingle<(string name, long notnull, string dflt_value)>(
            "SELECT name, [notnull], dflt_value FROM pragma_table_info('game_matches') WHERE name = 'ruleset_version'");
        var indexColumns = migrated.Query<string>("""
            SELECT name
            FROM pragma_index_info('ix_game_matches_duration_group')
            ORDER BY seqno
            """).ToList();
        var durationIndexCount = migrated.QuerySingle<long>("""
            SELECT COUNT(*)
            FROM pragma_index_list('game_matches')
            WHERE name = 'ix_game_matches_duration_group'
            """);
        var rulesetVersion = migrated.QuerySingle<long>(
            "SELECT ruleset_version FROM game_matches WHERE id = 1");
        Assert.AreEqual("ruleset_version", rulesetColumn.name);
        Assert.AreEqual(1L, rulesetColumn.notnull);
        Assert.AreEqual("1", rulesetColumn.dflt_value);
        Assert.AreEqual(
            "game_type,format,ruleset_version,ended_at", string.Join(',', indexColumns));
        Assert.AreEqual(1L, durationIndexCount);
        Assert.AreEqual(1L, rulesetVersion);
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

    [TestMethod]
    public async Task SaveCompletedMatch_PersistsExplicitRulesetVersion()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var now = DateTimeOffset.UtcNow;
        var match = new CompletedMatch(
            GameType: "rps",
            ChannelId: 7,
            Format: "bo3",
            RulesetVersion: 2,
            Outcome: "draw",
            AbandonReason: null,
            StartedAt: now.AddSeconds(-5),
            EndedAt: now,
            Participants: Array.Empty<CompletedParticipant>());

        var matchId = await repo.SaveCompletedMatchAsync(match);

        using var conn = db.CreateConnection();
        var rulesetVersion = await conn.QuerySingleAsync<long>(
            "SELECT ruleset_version FROM game_matches WHERE id = @matchId", new { matchId });
        Assert.AreEqual(2L, rulesetVersion);
    }

    [TestMethod]
    public async Task GetDurationSamples_ReturnsNewestHundredQualifyingRowsInGroup()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var matchIds = new Dictionary<int, long>();
        for (var i = 1; i <= 105; i++)
        {
            var endedAt = i is 5 or 6
                ? start.AddMinutes(6)
                : i is 104 or 105
                    ? start.AddMinutes(105)
                    : start.AddMinutes(i);
            matchIds[i] = await GameTestHelpers.InsertMatchAsync(
                db, "rps", "bo3", 2, i == 104 ? "draw" : "decided", i * 1000, endedAt);
        }

        await GameTestHelpers.InsertMatchAsync(
            db, "rps", "bo3", 2, "abandoned", 999000, start.AddDays(1));

        var samples = await repo.GetDurationSamplesAsync("rps", "bo3", 2, null);

        Assert.AreEqual(100, samples.Count);
        Assert.AreEqual(matchIds[105], samples[0].MatchId);
        Assert.AreEqual(105000L, samples[0].DurationMs);
        Assert.AreEqual(matchIds[104], samples[1].MatchId);
        Assert.AreEqual(104000L, samples[1].DurationMs);
        Assert.AreEqual(matchIds[6], samples[^1].MatchId);
        Assert.AreEqual(6000L, samples[^1].DurationMs);
        Assert.IsFalse(samples.Any(sample => sample.MatchId == matchIds[5]));
        Assert.IsTrue(samples.All(sample => sample.Outcome is "decided" or "draw"));
        for (var i = 1; i < samples.Count; i++)
        {
            Assert.IsTrue(samples[i - 1].EndedAt >= samples[i].EndedAt);
            if (samples[i - 1].EndedAt == samples[i].EndedAt)
                Assert.IsTrue(samples[i - 1].MatchId > samples[i].MatchId);
        }
    }

    [TestMethod]
    public async Task GetDurationSamples_IsolatesGroupAndAppliesStrictElapsedFilter()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var endedAt = new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 2, "decided", 1000, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 2, "draw", 1001, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 2, "abandoned", 2000, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 2, "pending", 2000, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 2, "decided", 0, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "deathroll", "bo3", 2, "decided", 2000, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo5", 2, "decided", 2000, endedAt);
        await GameTestHelpers.InsertMatchAsync(db, "rps", "bo3", 1, "decided", 2000, endedAt);

        var samples = await repo.GetDurationSamplesAsync("rps", "bo3", 2, 1000);

        Assert.AreEqual(1, samples.Count);
        Assert.AreEqual(1001L, samples[0].DurationMs);
        Assert.AreEqual("draw", samples[0].Outcome);
        Assert.AreEqual(endedAt, samples[0].EndedAt);
    }
}
