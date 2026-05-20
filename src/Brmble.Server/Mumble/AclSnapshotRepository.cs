using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Mumble;

public interface IAclSnapshotRepository
{
    Task UpsertAsync(AclChannelSnapshotDto snapshot);
    Task<AclChannelSnapshotDto?> GetAsync(int channelId);
    Task MarkStaleAsync(int channelId, string reason);
}

public static class AclSnapshotHasher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Compute(AclChannelSnapshotDto snapshot)
    {
        var canonical = snapshot with
        {
            FetchedAt = DateTimeOffset.UnixEpoch,
            Stale = false,
            Warning = null,
            SnapshotHash = ""
        };
        var json = JsonSerializer.Serialize(canonical, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
}

public sealed class AclSnapshotRepository : IAclSnapshotRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Database _db;

    public AclSnapshotRepository(Database db)
    {
        _db = db;
    }

    public async Task UpsertAsync(AclChannelSnapshotDto snapshot)
    {
        var hash = AclSnapshotHasher.Compute(snapshot);
        var canonical = snapshot with { Stale = false, Warning = null, SnapshotHash = hash };
        var json = JsonSerializer.Serialize(canonical, JsonOptions);
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            """
            INSERT INTO acl_snapshots (channel_id, payload_json, payload_hash, fetched_at, is_stale, stale_reason)
            VALUES (@ChannelId, @PayloadJson, @PayloadHash, @FetchedAt, 0, NULL)
            ON CONFLICT(channel_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                payload_hash = excluded.payload_hash,
                fetched_at = excluded.fetched_at,
                is_stale = 0,
                stale_reason = NULL
            """,
            new
            {
                snapshot.ChannelId,
                PayloadJson = json,
                PayloadHash = hash,
                FetchedAt = snapshot.FetchedAt.UtcDateTime.ToString("O")
            });
    }

    public async Task<AclChannelSnapshotDto?> GetAsync(int channelId)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync<Row>(
            """
            SELECT channel_id AS ChannelId, payload_json AS PayloadJson, payload_hash AS PayloadHash, is_stale AS IsStale, stale_reason AS StaleReason
            FROM acl_snapshots
            WHERE channel_id = @ChannelId
            """,
            new { ChannelId = channelId });
        if (row is null)
        {
            return null;
        }

        var snapshot = JsonSerializer.Deserialize<AclChannelSnapshotDto>(row.PayloadJson, JsonOptions);
        return snapshot is null
            ? null
            : snapshot with { Stale = row.IsStale != 0, Warning = row.StaleReason, SnapshotHash = row.PayloadHash };
    }

    public async Task MarkStaleAsync(int channelId, string reason)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            """
            UPDATE acl_snapshots
            SET is_stale = 1, stale_reason = @Reason
            WHERE channel_id = @ChannelId
            """,
            new { ChannelId = channelId, Reason = reason });
    }

    private sealed class Row
    {
        public long ChannelId { get; init; }
        public string PayloadJson { get; init; } = string.Empty;
        public string PayloadHash { get; init; } = string.Empty;
        public long IsStale { get; init; }
        public string? StaleReason { get; init; }
    }
}
