using Brmble.Server.Data;
using Brmble.Server.Games;
using Dapper;

namespace Brmble.Server.Tests.Games;

internal static class GameTestHelpers
{
    public static GameRepository NewRepo()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return new GameRepository(db);
    }

    public static (GameRepository repo, Database db) NewRepoWithDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return (new GameRepository(db), db);
    }

    public static async Task<long> InsertMatchAsync(
        Database db,
        string gameType,
        string format,
        int rulesetVersion,
        string outcome,
        long durationMs,
        DateTimeOffset endedAt)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleAsync<long>("""
            INSERT INTO game_matches
                (game_type, channel_id, format, ruleset_version, outcome, started_at, ended_at, duration_ms)
            VALUES
                (@gameType, 1, @format, @rulesetVersion, @outcome, @startedAt, @endedAt, @durationMs);
            SELECT last_insert_rowid();
            """, new
            {
                gameType,
                format,
                rulesetVersion,
                outcome,
                startedAt = endedAt.AddMilliseconds(-durationMs).ToString("o"),
                endedAt = endedAt.ToString("o"),
                durationMs,
            });
    }
}
