using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Games;

public record WindowedStats(int Wins, int Losses, int Draws, int Abandons, int GamesPlayed)
{
    public double WinRatio => GamesPlayed == 0 ? 0 : (double)Wins / GamesPlayed;
}

public record HeadToHeadGame(string GameType, int Wins, int Losses, int Draws)
{
    public int GamesPlayed => Wins + Losses + Draws;
}

public record HeadToHeadStats(int Wins, int Losses, int Draws, IReadOnlyList<HeadToHeadGame> Games)
{
    public int GamesPlayed => Wins + Losses + Draws;
    public double WinRatio => GamesPlayed == 0 ? 0 : (double)Wins / GamesPlayed;
}

public class GameStatsService
{
    private readonly Database _db;
    public GameStatsService(Database db) => _db = db;

    public async Task<WindowedStats> GetWindowedStatsAsync(long userId, string gameType, DateTimeOffset from, DateTimeOffset to)
    {
        using var conn = _db.CreateConnection();
        // SQLite returns INTEGER (incl. SUM/COUNT) as Int64, and SUM over zero rows is NULL.
        // COALESCE the SUMs to 0 and read into longs, then cast to the int-typed public model.
        var row = await conn.QuerySingleAsync<(long wins, long losses, long draws, long abandons, long played)>("""
            SELECT
                COALESCE(SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END), 0)       AS wins,
                COALESCE(SUM(CASE WHEN p.result = 'loss' THEN 1 ELSE 0 END), 0)      AS losses,
                COALESCE(SUM(CASE WHEN p.result = 'draw' THEN 1 ELSE 0 END), 0)      AS draws,
                COALESCE(SUM(CASE WHEN p.result = 'abandoned' THEN 1 ELSE 0 END), 0) AS abandons,
                COUNT(*)                                                             AS played
            FROM game_match_participants p
            JOIN game_matches m ON m.id = p.match_id
            WHERE p.user_id = @userId
              AND m.game_type = @gameType
              AND m.ended_at >= @from AND m.ended_at <= @to;
            """,
            new { userId, gameType, from = from.ToString("o"), to = to.ToString("o") });

        return new WindowedStats((int)row.wins, (int)row.losses, (int)row.draws, (int)row.abandons, (int)row.played);
    }

    /// <summary>
    /// Lifetime head-to-head record for <paramref name="selfUserId"/> against
    /// <paramref name="opponentUserId"/>, per game type plus a rolled-up total. Wins/losses
    /// are from self's perspective. Reads the canonical (low &lt; high) aggregate cache and
    /// flips it when self is the high id.
    /// </summary>
    public async Task<HeadToHeadStats> GetHeadToHeadAsync(long selfUserId, long opponentUserId)
    {
        var (low, high) = selfUserId < opponentUserId ? (selfUserId, opponentUserId) : (opponentUserId, selfUserId);
        var selfIsLow = selfUserId == low;

        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync<(string gameType, long lowWins, long highWins, long draws)>("""
            SELECT game_type AS gameType, low_wins AS lowWins, high_wins AS highWins, draws AS draws
            FROM game_head_to_head
            WHERE player_low_id = @low AND player_high_id = @high;
            """, new { low, high });

        var games = new List<HeadToHeadGame>();
        int totalW = 0, totalL = 0, totalD = 0;
        foreach (var r in rows)
        {
            var wins = (int)(selfIsLow ? r.lowWins : r.highWins);
            var losses = (int)(selfIsLow ? r.highWins : r.lowWins);
            var draws = (int)r.draws;
            games.Add(new HeadToHeadGame(r.gameType, wins, losses, draws));
            totalW += wins; totalL += losses; totalD += draws;
        }

        return new HeadToHeadStats(totalW, totalL, totalD, games);
    }
}
