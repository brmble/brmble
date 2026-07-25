using Brmble.Server.Data;
using Brmble.Server.Games.Duels;
using Dapper;

namespace Brmble.Server.Games;

public class GameRepository : IDurationSampleRepository
{
    private readonly Database _db;

    public GameRepository(Database db) => _db = db;

    public async Task<long> SaveCompletedMatchAsync(CompletedMatch match)
    {
        using var conn = _db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();

        var matchId = await conn.QuerySingleAsync<long>("""
            INSERT INTO game_matches
                (game_type, channel_id, format, ruleset_version, outcome, abandon_reason, started_at, ended_at, duration_ms, metadata_json)
            VALUES
                (@GameType, @ChannelId, @Format, @RulesetVersion, @Outcome, @AbandonReason, @StartedAt, @EndedAt, @DurationMs, @MetadataJson);
            SELECT last_insert_rowid();
            """,
            new
            {
                match.GameType,
                match.ChannelId,
                match.Format,
                match.RulesetVersion,
                match.Outcome,
                match.AbandonReason,
                StartedAt = match.StartedAt.ToString("o"),
                EndedAt = match.EndedAt.ToString("o"),
                DurationMs = (long)(match.EndedAt - match.StartedAt).TotalMilliseconds,
                match.MetadataJson,
            }, tx);

        foreach (var p in match.Participants)
        {
            await conn.ExecuteAsync("""
                INSERT INTO game_match_participants (match_id, user_id, placement, score, result, metadata_json)
                VALUES (@MatchId, @UserId, @Placement, @Score, @Result, @MetadataJson);
                """,
                new { MatchId = matchId, p.UserId, p.Placement, p.Score, p.Result, p.MetadataJson }, tx);

            await UpsertUserStatsAsync(conn, tx, p.UserId, match.GameType, p.Result);
        }

        if (match.Participants.Count == 2)
        {
            await UpsertHeadToHeadAsync(conn, tx, match.GameType, match.Participants[0], match.Participants[1]);
        }

        tx.Commit();
        return matchId;
    }

    public async Task<GameMatch?> GetMatchAsync(long matchId)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync("""
            SELECT id AS Id, game_type AS GameType, channel_id AS ChannelId, format AS Format,
                   ruleset_version AS RulesetVersion, outcome AS Outcome, abandon_reason AS AbandonReason,
                   started_at AS StartedAt, ended_at AS EndedAt, duration_ms AS DurationMs,
                   metadata_json AS MetadataJson
            FROM game_matches WHERE id = @matchId;
            """, new { matchId });
        if (row is null) return null;
        return new GameMatch(
            (long)row.Id, (string)row.GameType, (int)(long)row.ChannelId, (string)row.Format,
            (int)(long)row.RulesetVersion, (string)row.Outcome, (string?)row.AbandonReason,
            (string)row.StartedAt, (string)row.EndedAt, (long)row.DurationMs, (string?)row.MetadataJson);
    }

    private static async Task UpsertUserStatsAsync(System.Data.IDbConnection conn, System.Data.IDbTransaction tx,
        long userId, string gameType, string result)
    {
        var now = DateTimeOffset.UtcNow.ToString("o");
        await conn.ExecuteAsync("""
            INSERT INTO game_user_stats (user_id, game_type, wins, losses, draws, abandons, games_played, updated_at)
            VALUES (@UserId, @GameType,
                    @Win, @Loss, @Draw, @Abandon, 1, @Now)
            ON CONFLICT(user_id, game_type) DO UPDATE SET
                wins = wins + @Win,
                losses = losses + @Loss,
                draws = draws + @Draw,
                abandons = abandons + @Abandon,
                games_played = games_played + 1,
                updated_at = @Now;
            """,
            new
            {
                UserId = userId,
                GameType = gameType,
                Win = result == "win" ? 1 : 0,
                Loss = result == "loss" ? 1 : 0,
                Draw = result == "draw" ? 1 : 0,
                Abandon = result == "abandoned" ? 1 : 0,
                Now = now,
            }, tx);
    }

    private static async Task UpsertHeadToHeadAsync(System.Data.IDbConnection conn, System.Data.IDbTransaction tx,
        string gameType, CompletedParticipant a, CompletedParticipant b)
    {
        var (low, high) = a.UserId < b.UserId ? (a, b) : (b, a);
        var lowWin = low.Result == "win" ? 1 : 0;
        var highWin = high.Result == "win" ? 1 : 0;
        var draw = low.Result == "draw" ? 1 : 0;
        var now = DateTimeOffset.UtcNow.ToString("o");

        await conn.ExecuteAsync("""
            INSERT INTO game_head_to_head (player_low_id, player_high_id, game_type, low_wins, high_wins, draws, updated_at)
            VALUES (@Low, @High, @GameType, @LowWin, @HighWin, @Draw, @Now)
            ON CONFLICT(player_low_id, player_high_id, game_type) DO UPDATE SET
                low_wins = low_wins + @LowWin,
                high_wins = high_wins + @HighWin,
                draws = draws + @Draw,
                updated_at = @Now;
            """,
            new { Low = low.UserId, High = high.UserId, GameType = gameType, LowWin = lowWin, HighWin = highWin, Draw = draw, Now = now }, tx);
    }

    public async Task<UserGameStats> GetUserStatsAsync(long userId, string gameType)
    {
        using var conn = _db.CreateConnection();
        // SQLite returns INTEGER columns as Int64; UserGameStats uses Int32 positional
        // constructor params, so Dapper cannot materialize the record directly. Map manually.
        var row = await conn.QuerySingleOrDefaultAsync("""
            SELECT wins AS Wins, losses AS Losses, draws AS Draws,
                   abandons AS Abandons, games_played AS GamesPlayed
            FROM game_user_stats WHERE user_id = @userId AND game_type = @gameType;
            """, new { userId, gameType });

        if (row is null)
            return new UserGameStats(userId, gameType, 0, 0, 0, 0, 0);

        return new UserGameStats(
            userId,
            gameType,
            (int)(long)row.Wins,
            (int)(long)row.Losses,
            (int)(long)row.Draws,
            (int)(long)row.Abandons,
            (int)(long)row.GamesPlayed);
    }

    public async Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync("""
            SELECT id AS MatchId, duration_ms AS DurationMs, outcome AS Outcome, ended_at AS EndedAt
            FROM game_matches
            WHERE game_type=@gameType AND format=@format AND ruleset_version=@rulesetVersion
            AND outcome IN ('decided','draw') AND duration_ms > 0
            AND (@elapsedGreaterThanMs IS NULL OR duration_ms > @elapsedGreaterThanMs)
            ORDER BY ended_at DESC, id DESC LIMIT 100;
            """, new { gameType, format, rulesetVersion, elapsedGreaterThanMs });

        return rows.Select(row => new DurationSample(
            (long)row.MatchId,
            (long)row.DurationMs,
            (string)row.Outcome,
            DateTimeOffset.Parse((string)row.EndedAt))).ToList();
    }
}
