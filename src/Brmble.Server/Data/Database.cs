using System.Data;
using Brmble.Server.ChannelRequests;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Brmble.Server.Data;

public class Database
{
    private readonly string _connectionString;

    public Database(string connectionString)
    {
        _connectionString = connectionString;
    }

    public IDbConnection CreateConnection() => new SqliteConnection(_connectionString);

    public void Initialize()
    {
        using var conn = CreateConnection();
        conn.Open(); // Keep connection open so Dapper doesn't close between statements
        conn.Execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                cert_hash       TEXT NOT NULL UNIQUE,
                display_name    TEXT NOT NULL,
                matrix_user_id  TEXT NOT NULL UNIQUE,
                matrix_access_token TEXT,
                created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS channel_room_map (
                mumble_channel_id  INTEGER NOT NULL,
                matrix_room_id     TEXT NOT NULL UNIQUE,
                created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (mumble_channel_id)
            );
            CREATE TABLE IF NOT EXISTS dm_room_map (
                user_id_low     INTEGER NOT NULL,
                user_id_high    INTEGER NOT NULL,
                matrix_room_id  TEXT NOT NULL UNIQUE,
                created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id_low, user_id_high),
                CHECK (user_id_low < user_id_high)
            );
            CREATE TABLE IF NOT EXISTS acl_snapshots (
                channel_id      INTEGER PRIMARY KEY,
                payload_json    TEXT NOT NULL,
                payload_hash    TEXT NOT NULL,
                fetched_at      TEXT NOT NULL,
                is_stale        INTEGER NOT NULL DEFAULT 0,
                stale_reason    TEXT
            );
            """);

        var channelRequestStatuses = ChannelRequestStatus.SqlCheckConstraintList;
        conn.Execute($"""
            CREATE TABLE IF NOT EXISTS channel_requests (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                requester_user_id       INTEGER NOT NULL,
                requester_display_name  TEXT NOT NULL,
                requested_channel_name  TEXT NOT NULL,
                normalized_channel_name TEXT NOT NULL,
                pending_slot            INTEGER,
                reason                  TEXT,
                status                  TEXT NOT NULL,
                created_at_utc          TEXT NOT NULL,
                updated_at_utc          TEXT NOT NULL,
                handled_at_utc          TEXT,
                handled_by_user_id      INTEGER,
                handled_by_display_name TEXT,
                decision_reason         TEXT,
                created_channel_id      INTEGER,
                created_channel_name    TEXT,
                last_approval_error     TEXT,
                approval_attempt_count  INTEGER NOT NULL DEFAULT 0,
                CHECK (status IN ({channelRequestStatuses}))
            );

            CREATE INDEX IF NOT EXISTS ix_channel_requests_status_created_at
                ON channel_requests(status, created_at_utc);

            CREATE INDEX IF NOT EXISTS ix_channel_requests_requester_user_id
                ON channel_requests(requester_user_id);

            CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_requests_pending_requester_name
                ON channel_requests(requester_user_id, normalized_channel_name)
                WHERE status = 'pending';

            CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_requests_pending_requester_slot
                ON channel_requests(requester_user_id, pending_slot)
                WHERE status = 'pending' AND pending_slot IS NOT NULL;
            """);

        conn.Execute("""
            CREATE TABLE IF NOT EXISTS game_matches (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                game_type       TEXT NOT NULL,
                channel_id      INTEGER NOT NULL,
                format          TEXT NOT NULL DEFAULT '1v1',
                outcome         TEXT NOT NULL,
                abandon_reason  TEXT,
                started_at      TEXT NOT NULL,
                ended_at        TEXT NOT NULL,
                duration_ms     INTEGER NOT NULL DEFAULT 0,
                metadata_json   TEXT
            );
            CREATE TABLE IF NOT EXISTS game_match_participants (
                match_id        INTEGER NOT NULL,
                user_id         INTEGER NOT NULL,
                placement       INTEGER NOT NULL,
                score           INTEGER,
                result          TEXT NOT NULL,
                metadata_json   TEXT,
                PRIMARY KEY (match_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS game_user_stats (
                user_id         INTEGER NOT NULL,
                game_type       TEXT NOT NULL,
                wins            INTEGER NOT NULL DEFAULT 0,
                losses          INTEGER NOT NULL DEFAULT 0,
                draws           INTEGER NOT NULL DEFAULT 0,
                abandons        INTEGER NOT NULL DEFAULT 0,
                games_played    INTEGER NOT NULL DEFAULT 0,
                updated_at      TEXT NOT NULL,
                PRIMARY KEY (user_id, game_type)
            );
            CREATE TABLE IF NOT EXISTS game_head_to_head (
                player_low_id   INTEGER NOT NULL,
                player_high_id  INTEGER NOT NULL,
                game_type       TEXT NOT NULL,
                low_wins        INTEGER NOT NULL DEFAULT 0,
                high_wins       INTEGER NOT NULL DEFAULT 0,
                draws           INTEGER NOT NULL DEFAULT 0,
                updated_at      TEXT NOT NULL,
                PRIMARY KEY (player_low_id, player_high_id, game_type),
                CHECK (player_low_id < player_high_id)
            );
            CREATE INDEX IF NOT EXISTS ix_game_matches_ended_at ON game_matches(ended_at);
            CREATE INDEX IF NOT EXISTS ix_game_matches_game_type ON game_matches(game_type);
            CREATE INDEX IF NOT EXISTS ix_gmp_user_id ON game_match_participants(user_id);
            CREATE INDEX IF NOT EXISTS ix_gmp_match_id ON game_match_participants(match_id);
            """);

        // Migrate existing deployments: add matrix_access_token if the column is missing
        var hasMatrixToken = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='matrix_access_token'");
        if (hasMatrixToken == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN matrix_access_token TEXT");

        // Migrate: add avatar_source column
        var hasAvatarSource = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='avatar_source'");
        if (hasAvatarSource == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN avatar_source TEXT");

        // Migrate: add texture_hash column (for deduplicating Mumble texture uploads)
        var hasTextureHash = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='texture_hash'");
        if (hasTextureHash == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN texture_hash TEXT");

        // Migrate: add companion_id column for persisted companion selection
        var hasCompanionId = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='companion_id'");
        if (hasCompanionId == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN companion_id TEXT DEFAULT 'floppy'");

        // Migrate: add challenges_blocked column (server-authoritative game invite block)
        var hasChallengesBlocked = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='challenges_blocked'");
        if (hasChallengesBlocked == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN challenges_blocked INTEGER NOT NULL DEFAULT 0");
    }
}
