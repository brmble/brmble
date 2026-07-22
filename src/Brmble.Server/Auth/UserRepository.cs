// src/Brmble.Server/Auth/UserRepository.cs
using Dapper;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

public record User(long Id, string CertHash, string DisplayName, string MatrixUserId, string? MatrixAccessToken);

public class UserRepository
{
    private static readonly HashSet<string> ValidCompanionIds =
    [
        "bee", "engineer", "floppy", "patch", "pip", "retro"
    ];

    private readonly Database _db;
    private readonly string _serverDomain;

    public UserRepository(Database db, IOptions<MatrixSettings> settings)
    {
        _db = db;
        _serverDomain = settings.Value.ServerDomain;
    }

    public virtual async Task<User?> GetByCertHash(string certHash)
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

    public async Task<List<User>> GetAllAsync()
    {
        using var conn = _db.CreateConnection();
        var users = await conn.QueryAsync<User>(
            """
            SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId, matrix_access_token AS MatrixAccessToken
            FROM users
            """);
        return users.ToList();
    }

    public async Task<string?> GetAvatarSource(long userId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<string?>(
            "SELECT avatar_source FROM users WHERE id = @Id",
            new { Id = userId });
    }

    public async Task SetAvatarSource(long userId, string? source)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET avatar_source = @Source WHERE id = @Id",
            new { Source = source, Id = userId });
    }

    public async Task<string?> GetTextureHash(long userId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<string?>(
            "SELECT texture_hash FROM users WHERE id = @Id",
            new { Id = userId });
    }

    public async Task SetTextureHash(long userId, string? hash)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET texture_hash = @Hash WHERE id = @Id",
            new { Hash = hash, Id = userId });
    }

    public static bool TryNormalizeCompanionId(string? companionId, out string normalized)
    {
        var candidate = companionId?.Trim().ToLowerInvariant();
        if (candidate is not null && ValidCompanionIds.Contains(candidate))
        {
            normalized = candidate;
            return true;
        }

        normalized = "floppy";
        return false;
    }

    public async Task<string> GetCompanionId(long userId)
    {
        using var conn = _db.CreateConnection();
        var companionId = await conn.QuerySingleOrDefaultAsync<string?>(
            "SELECT companion_id FROM users WHERE id = @Id",
            new { Id = userId });

        return NormalizeCompanionId(companionId);
    }

    public async Task SetCompanionId(long userId, string companionId)
    {
        using var conn = _db.CreateConnection();
        var normalized = NormalizeCompanionId(companionId);
        await conn.ExecuteAsync(
            "UPDATE users SET companion_id = @CompanionId WHERE id = @Id",
            new { CompanionId = normalized, Id = userId });
    }

    public async Task<bool> GetChallengesBlocked(long userId)
    {
        using var conn = _db.CreateConnection();
        var blocked = await conn.QuerySingleOrDefaultAsync<long?>(
            "SELECT challenges_blocked FROM users WHERE id = @Id",
            new { Id = userId });
        return blocked == 1;
    }

    public async Task SetChallengesBlocked(long userId, bool blocked)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET challenges_blocked = @Blocked WHERE id = @Id",
            new { Blocked = blocked ? 1 : 0, Id = userId });
    }

    private static string NormalizeCompanionId(string? companionId)
    {
        TryNormalizeCompanionId(companionId, out var normalized);
        return normalized;
    }

    public virtual async Task<User?> GetByMatrixUserId(string matrixUserId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            """
            SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId, matrix_access_token AS MatrixAccessToken
            FROM users
            WHERE matrix_user_id = @MatrixUserId
            """,
            new { MatrixUserId = matrixUserId });
    }
}
