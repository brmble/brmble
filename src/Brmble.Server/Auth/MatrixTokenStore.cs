using System.Security.Cryptography;
using Brmble.Server.Data;
using Dapper;
using Microsoft.AspNetCore.DataProtection;

namespace Brmble.Server.Auth;

internal sealed record MatrixTokenLease(
    long UserId,
    string AccessToken,
    long ExpiresAtUnixMs,
    string StoredValue);

internal sealed class MatrixTokenStore
{
    internal const string StoragePrefix = "dp:v1:";
    private const string ProtectorPurpose = "Brmble.Server.Auth.MatrixAccessToken.v1";

    private readonly Database _db;
    private readonly IDataProtector _protector;

    internal MatrixTokenStore(Database db, IDataProtectionProvider dataProtectionProvider)
    {
        _db = db;
        _protector = dataProtectionProvider.CreateProtector(ProtectorPurpose);
    }

    internal async Task<MatrixTokenLease?> GetAsync(long userId)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync<TokenRow>("""
            SELECT id AS UserId,
                   matrix_access_token AS StoredValue,
                   token_expires_at AS ExpiresAtUnixMs
            FROM users
            WHERE id = @UserId
            """, new { UserId = userId });

        if (row?.StoredValue is null || row.ExpiresAtUnixMs is null)
            return null;

        return ToLease(row);
    }

    internal async Task<MatrixTokenLease> SaveAsync(long userId, string accessToken, long expiresAtUnixMs)
    {
        var storedValue = Protect(accessToken);
        using var conn = _db.CreateConnection();
        var changed = await conn.ExecuteAsync("""
            UPDATE users
            SET matrix_access_token = @StoredValue,
                token_expires_at = @ExpiresAtUnixMs
            WHERE id = @UserId
            """, new { UserId = userId, StoredValue = storedValue, ExpiresAtUnixMs = expiresAtUnixMs });

        if (changed != 1)
            throw new InvalidOperationException($"Cannot store Matrix token for unknown user {userId}.");

        return new MatrixTokenLease(userId, accessToken, expiresAtUnixMs, storedValue);
    }

    internal async Task<bool> ClearIfCurrentAsync(long userId, string expectedStoredValue)
    {
        using var conn = _db.CreateConnection();
        var changed = await conn.ExecuteAsync("""
            UPDATE users
            SET matrix_access_token = NULL,
                token_expires_at = NULL
            WHERE id = @UserId
              AND matrix_access_token = @ExpectedStoredValue
            """, new { UserId = userId, ExpectedStoredValue = expectedStoredValue });
        return changed == 1;
    }

    internal async Task<bool> ExpireIfCurrentAsync(long userId, string expectedStoredValue, long expiresAtUnixMs)
    {
        using var conn = _db.CreateConnection();
        var changed = await conn.ExecuteAsync("""
            UPDATE users
            SET token_expires_at = @ExpiresAtUnixMs
            WHERE id = @UserId
              AND matrix_access_token = @ExpectedStoredValue
            """, new { UserId = userId, ExpectedStoredValue = expectedStoredValue, ExpiresAtUnixMs = expiresAtUnixMs });
        return changed == 1;
    }

    internal async Task<IReadOnlyList<MatrixTokenLease>> GetExpiredAsync(long nowUnixMs, int limit = 100)
    {
        using var conn = _db.CreateConnection();
        var rows = (await conn.QueryAsync<TokenRow>("""
            SELECT id AS UserId,
                   matrix_access_token AS StoredValue,
                   token_expires_at AS ExpiresAtUnixMs
            FROM users
            WHERE matrix_access_token IS NOT NULL
              AND token_expires_at IS NOT NULL
              AND token_expires_at <= @NowUnixMs
            ORDER BY token_expires_at, id
            LIMIT @Limit
            """, new { NowUnixMs = nowUnixMs, Limit = limit })).ToList();

        return rows
            .Where(row => row.StoredValue is not null && row.ExpiresAtUnixMs is not null)
            .Select(ToLease)
            .ToList();
    }

    internal async Task<int> ProtectLegacyTokensAsync(long nowUnixMs)
    {
        using var conn = _db.CreateConnection();
        var rows = (await conn.QueryAsync<TokenRow>("""
            SELECT id AS UserId,
                   matrix_access_token AS StoredValue,
                   token_expires_at AS ExpiresAtUnixMs
            FROM users
            WHERE matrix_access_token IS NOT NULL
            """)).ToList();

        var migrated = 0;
        foreach (var row in rows)
        {
            if (row.StoredValue is null)
                continue;

            var storedValue = row.StoredValue;
            if (!storedValue.StartsWith(StoragePrefix, StringComparison.Ordinal))
            {
                storedValue = Protect(storedValue);
                migrated++;
            }

            var expiresAt = row.ExpiresAtUnixMs ?? nowUnixMs;
            await conn.ExecuteAsync("""
                UPDATE users
                SET matrix_access_token = @StoredValue,
                    token_expires_at = @ExpiresAtUnixMs
                WHERE id = @UserId
                """, new { row.UserId, StoredValue = storedValue, ExpiresAtUnixMs = expiresAt });
        }

        return migrated;
    }

    private MatrixTokenLease ToLease(TokenRow row)
    {
        if (row.StoredValue is null || row.ExpiresAtUnixMs is null)
            throw new InvalidOperationException("Incomplete Matrix token row.");

        return new MatrixTokenLease(row.UserId, Unprotect(row.StoredValue), row.ExpiresAtUnixMs.Value, row.StoredValue);
    }

    private string Protect(string accessToken) => StoragePrefix + _protector.Protect(accessToken);

    private string Unprotect(string storedValue)
    {
        if (!storedValue.StartsWith(StoragePrefix, StringComparison.Ordinal))
            throw new CryptographicException("Matrix token row is not Data Protection protected.");

        return _protector.Unprotect(storedValue[StoragePrefix.Length..]);
    }

    private sealed class TokenRow
    {
        public long UserId { get; set; }
        public string? StoredValue { get; set; }
        public long? ExpiresAtUnixMs { get; set; }
    }
}
