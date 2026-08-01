using System.Text.Json.Serialization;

namespace Brmble.Server.Events;

/// <summary>
/// Wire shape for one session-mapping entry in a snapshot.
/// </summary>
/// <remarks>
/// <para>
/// <c>isBrmbleClient</c> is omitted entirely when unknown rather than written as an explicit
/// null. Shipped clients parse it with
/// <c>TryGetProperty("isBrmbleClient", out var b) &amp;&amp; b.GetBoolean()</c>, and
/// <see cref="System.Text.Json.JsonElement.GetBoolean"/> throws on a Null value kind while
/// <c>TryGetProperty</c> reports the property as present. Since this runs while handling the
/// <c>/auth/token</c> response, a null would throw inside credential handling on every
/// already-installed client. An absent property makes an old client fall back to <c>false</c>
/// — today's behaviour — and means "unknown" to a projection-aware client (spec §3.2 rule 2).
/// </para>
/// <para>
/// <c>false</c> is still written explicitly: an observed deactivation is knowledge, not an
/// absence. <c>customCompanionId</c> is likewise never omitted — a null there is meaningful to
/// companion parsing, which is why the omission is per-property and not a global
/// <c>DefaultIgnoreCondition</c>.
/// </para>
/// <para>
/// Property names are pinned with <see cref="JsonPropertyNameAttribute"/> so the shape is
/// identical under the event bus's camelCase policy and under default serialiser options.
/// </para>
/// </remarks>
public sealed record SessionMappingWire
{
    [JsonPropertyName("matrixUserId")]
    public required string MatrixUserId { get; init; }

    [JsonPropertyName("mumbleName")]
    public required string MumbleName { get; init; }

    [JsonPropertyName("companionId")]
    public required string CompanionId { get; init; }

    [JsonPropertyName("customCompanionId")]
    public string? CustomCompanionId { get; init; }

    [JsonPropertyName("certHash")]
    public string? CertHash { get; init; }

    [JsonPropertyName("isBrmbleClient")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsBrmbleClient { get; init; }

    public static SessionMappingWire From(SessionMapping mapping)
    {
        var wire = Companions.CompanionWireSelection.FromPersisted(mapping.CompanionId);
        return new SessionMappingWire
        {
            MatrixUserId = mapping.MatrixUserId,
            MumbleName = mapping.MumbleName,
            CompanionId = wire.CompanionId,
            CustomCompanionId = wire.CustomCompanionId,
            CertHash = mapping.CertHash,
            IsBrmbleClient = mapping.IsBrmbleClient
        };
    }
}
