using System.Data;
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
            CREATE TABLE IF NOT EXISTS message_redactions (
                id                          INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id                     TEXT NOT NULL,
                event_id                    TEXT NOT NULL,
                redaction_event_id          TEXT NOT NULL UNIQUE,
                deleted_by_matrix_user_id   TEXT NOT NULL,
                reason                      TEXT NOT NULL,
                placeholder_text            TEXT NOT NULL,
                actor_type                  TEXT NOT NULL,
                deleted_at                  TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_message_redactions_room_event
                ON message_redactions(room_id, event_id);
            CREATE INDEX IF NOT EXISTS idx_message_redactions_room_id
                ON message_redactions(room_id);
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
    }
}
