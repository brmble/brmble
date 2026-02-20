// src/Brmble.Server/Auth/UserRepository.cs
using Dapper;
using Brmble.Server.Data;
using Microsoft.Extensions.Configuration;

namespace Brmble.Server.Auth;

public record User(long Id, string CertHash, string DisplayName, string MatrixUserId);

public class UserRepository
{
    private readonly Database _db;
    private readonly string _serverDomain;

    public UserRepository(Database db, IConfiguration configuration)
    {
        _db = db;
        _serverDomain = configuration["Matrix:ServerDomain"] ?? "localhost";
    }

    public async Task<User?> GetByCertHash(string certHash)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            """
            SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId
            FROM users
            WHERE cert_hash = @CertHash
            """,
            new { CertHash = certHash });
    }

    public async Task<User> Insert(string certHash, string? displayName)
    {
        using var conn = _db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();

        await conn.ExecuteAsync(
            "INSERT INTO users (cert_hash, display_name, matrix_user_id) VALUES (@CertHash, 'pending', 'pending')",
            new { CertHash = certHash },
            tx);

        var id = await conn.QuerySingleAsync<long>("SELECT last_insert_rowid()", transaction: tx);
        var matrixUserId = $"@{id}:{_serverDomain}";
        var finalDisplayName = string.IsNullOrEmpty(displayName) ? $"user_{id}" : displayName;

        await conn.ExecuteAsync(
            "UPDATE users SET display_name = @DisplayName, matrix_user_id = @MatrixUserId WHERE id = @Id",
            new { DisplayName = finalDisplayName, MatrixUserId = matrixUserId, Id = id },
            tx);

        tx.Commit();
        return new User(id, certHash, finalDisplayName, matrixUserId);
    }

    public async Task UpdateDisplayName(long id, string displayName)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET display_name = @DisplayName WHERE id = @Id",
            new { DisplayName = displayName, Id = id });
    }
}
