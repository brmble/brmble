// src/Brmble.Server/Auth/UserRepository.cs
using Dapper;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

public record User(long Id, string CertHash, string DisplayName, string MatrixUserId, string? MatrixAccessToken);

public class UserRepository
{
    private readonly Database _db;
    private readonly string _serverDomain;

    public UserRepository(Database db, IOptions<MatrixSettings> settings)
    {
        _db = db;
        _serverDomain = settings.Value.ServerDomain;
    }

    public async Task<User?> GetByCertHash(string certHash)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            """
            SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId, matrix_access_token AS MatrixAccessToken
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
        return new User(id, certHash, finalDisplayName, matrixUserId, null);
    }

    public async Task UpdateDisplayName(long id, string displayName)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET display_name = @DisplayName WHERE id = @Id",
            new { DisplayName = displayName, Id = id });
    }

    public async Task UpdateMatrixToken(long id, string token)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET matrix_access_token = @Token WHERE id = @Id",
            new { Token = token, Id = id });
    }
}
