using System.Text.Json;
using Brmble.Client.Services.Voice.Projection;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Translates Brmble wire payloads into <see cref="UserProjectionStore"/> inputs.
/// </summary>
/// <remarks>
/// This is the only place that knows both JSON and the projection. Keeping it out of the
/// <c>Projection</c> namespace is what lets the store be unit-tested without a protocol stack,
/// and what stops wire quirks leaking into the merge rules.
/// </remarks>
internal static class ProjectionWire
{
    /// <summary>
    /// Reads a <c>sessionMappingSnapshot</c> or an <c>/auth/token</c> body. Returns null when the
    /// payload carries no envelope or no mappings block, because neither can establish a cursor.
    /// </summary>
    internal static ServerSnapshot? ReadSnapshot(JsonElement root)
    {
        var instanceId = ReadString(root, "instanceId");
        if (string.IsNullOrEmpty(instanceId)) return null;
        if (!root.TryGetProperty("revision", out var revision) ||
            revision.ValueKind != JsonValueKind.Number) return null;

        // The two bootstrap transports name the same block differently: the WebSocket snapshot
        // calls it "mappings", the /auth/token body "sessionMappings". Both must be understood,
        // because the store takes whatever it is handed as the complete truth about every session.
        if (!TryReadMappingsBlock(root, out var raw))
            // No block under either name means this is a payload we failed to understand, not a
            // server stating that it knows nobody. Applying an empty table as authoritative would
            // reset every row's identity on the strength of a parsing miss -- precisely the
            // "absent is not known-empty" rule the projection exists to enforce.
            return null;

        var mappings = new Dictionary<uint, ServerMappingEntry>();
        foreach (var property in raw.EnumerateObject())
        {
            if (!uint.TryParse(property.Name, out var sessionId)) continue;
            mappings[sessionId] = ReadEntry(property.Value);
        }

        return new ServerSnapshot(instanceId, revision.GetInt64(), mappings);
    }

    /// <summary>
    /// Finds the mappings object under either transport's name. An explicitly empty object is a
    /// legitimate statement and succeeds; a missing one does not.
    /// </summary>
    private static bool TryReadMappingsBlock(JsonElement root, out JsonElement mappings)
    {
        if (root.TryGetProperty("mappings", out var wire) && wire.ValueKind == JsonValueKind.Object)
        {
            mappings = wire;
            return true;
        }

        if (root.TryGetProperty("sessionMappings", out var auth) && auth.ValueKind == JsonValueKind.Object)
        {
            mappings = auth;
            return true;
        }

        mappings = default;
        return false;
    }

    /// <summary>
    /// Reads one incremental mapping event. Returns null for any payload that is not one — the
    /// caller dispatches every WebSocket message through here.
    /// </summary>
    /// <remarks>
    /// Rejecting a payload drops its revision as well as its content, so the next event looks
    /// like a gap and costs one resync. That is the intended trade: a resync repairs, whereas
    /// advancing the cursor past an event we could not interpret would silently skip whatever
    /// the server actually changed, with nothing left to detect it. Cheap and self-correcting
    /// beats quiet and permanent.
    /// </remarks>
    internal static ServerEvent? ReadEvent(string? type, JsonElement root)
    {
        var kind = type switch
        {
            "userMappingAdded" => ServerEventKind.MappingAdded,
            "userMappingRemoved" => ServerEventKind.MappingRemoved,
            "companionChanged" => ServerEventKind.CompanionChanged,
            "brmbleClientActivated" => ServerEventKind.BrmbleActivated,
            "brmbleClientDeactivated" => ServerEventKind.BrmbleDeactivated,
            _ => (ServerEventKind?)null
        };
        if (kind is null) return null;

        var instanceId = ReadString(root, "instanceId");
        if (string.IsNullOrEmpty(instanceId)) return null;

        if (!root.TryGetProperty("sessionId", out var session) ||
            session.ValueKind != JsonValueKind.Number) return null;
        var sessionId = session.GetUInt32();
        if (sessionId == 0) return null;

        if (!root.TryGetProperty("revision", out var revisionProperty) ||
            revisionProperty.ValueKind != JsonValueKind.Number) return null;
        var revision = revisionProperty.GetInt64();

        // A server predating Phase 1 sends no baseRevision. Assuming the operation bumped once
        // is the only reading under which an old server can still drive a new client; a wrong
        // guess costs one redundant snapshot, not a wrong value.
        var baseRevision = root.TryGetProperty("baseRevision", out var b) &&
                           b.ValueKind == JsonValueKind.Number
            ? b.GetInt64()
            : revision - 1;

        // Removal and the two activation events assert their meaning through Kind alone; only
        // the field-carrying events need an entry.
        var entry = kind is ServerEventKind.MappingAdded or ServerEventKind.CompanionChanged
            ? ReadEntry(root)
            : null;

        return new ServerEvent(kind.Value, instanceId, baseRevision, revision, sessionId, entry);
    }

    /// <summary>
    /// The single wire shape for a user row. Every field is always present, nulls included, so a
    /// consumer replaces by session id and never merges field-by-field.
    /// </summary>
    internal static object ToWireRow(UserProjection row) => new
    {
        session = row.SessionId,
        name = row.Name,
        channelId = row.ChannelId,
        muted = row.Muted,
        deafened = row.Deafened,
        self = row.IsSelf,
        comment = row.Comment,
        certHash = row.CertHash,
        matrixUserId = row.MatrixUserId,
        companionId = row.CompanionId,
        isBrmbleClient = row.IsBrmbleClient
    };

    /// <summary>
    /// Reads the server-owned half of one session. Every absent field becomes null, which the
    /// store reads as "not known" — this is where the old parser's <c>"floppy"</c> default and
    /// its <c>isBrmbleClient: false</c> default are removed.
    /// </summary>
    private static ServerMappingEntry ReadEntry(JsonElement element) =>
        new(ReadString(element, "matrixUserId"),
            ReadCompanionId(element),
            ReadNullableBool(element, "isBrmbleClient"),
            ReadString(element, "certHash"));

    /// <summary>
    /// Prefers the custom companion over the legacy field. The legacy split transmits
    /// <c>companionId: "floppy"</c> alongside the real selection in <c>customCompanionId</c>,
    /// so reading the legacy field first would turn every custom skin into a floppy.
    /// </summary>
    private static string? ReadCompanionId(JsonElement element)
    {
        if (ReadString(element, "customCompanionId") is { } custom &&
            custom.StartsWith("custom:$", StringComparison.Ordinal))
            return custom;

        return ReadString(element, "companionId");
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool? ReadNullableBool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null
            }
            : null;
}
