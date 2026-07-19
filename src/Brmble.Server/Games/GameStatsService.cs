using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Games;

public record WindowedStats(int Wins, int Losses, int Draws, int Abandons, int GamesPlayed)
{
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
}
