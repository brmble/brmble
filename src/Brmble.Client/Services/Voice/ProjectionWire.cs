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
    /// payload carries no envelope, because a snapshot without one cannot establish a cursor.
    /// </summary>
    internal static ServerSnapshot? ReadSnapshot(JsonElement root)
    {
        var instanceId = ReadString(root, "instanceId");
        if (string.IsNullOrEmpty(instanceId)) return null;
        if (!root.TryGetProperty("revision", out var revision) ||
            revision.ValueKind != JsonValueKind.Number) return null;

        var mappings = new Dictionary<uint, ServerMappingEntry>();
        if (root.TryGetProperty("mappings", out var raw) && raw.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in raw.EnumerateObject())
            {
                if (!uint.TryParse(property.Name, out var sessionId)) continue;
                mappings[sessionId] = ReadEntry(property.Value);
            }
        }

        return new ServerSnapshot(instanceId, revision.GetInt64(), mappings);
    }

    /// <summary>
    /// Reads one incremental mapping event. Returns null for any payload that is not one — the
    /// caller dispatches every WebSocket message through here.
    /// </summary>
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
