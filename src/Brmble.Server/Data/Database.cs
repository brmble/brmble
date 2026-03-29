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
    }
}
