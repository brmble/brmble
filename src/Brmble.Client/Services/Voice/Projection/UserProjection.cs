namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// One row of the authoritative user projection: Mumble-native presence merged with
/// Brmble-owned identity.
/// </summary>
/// <remarks>
/// Fields are grouped by owner and never cross. A Mumble input may write only the first group,
/// a server input only the second. In the server group, <c>null</c> means "not known" rather
/// than "empty" — see <see cref="UserProjectionStore"/> for the rule that preserves it.
/// </remarks>
internal sealed record UserProjection
{
    public required uint SessionId { get; init; }

    // ---- Mumble-owned. Authoritative, including when empty: UserState is complete every time.
    public string? Name { get; init; }
    public uint ChannelId { get; init; }
    public bool Muted { get; init; }
    public bool Deafened { get; init; }
    public string? Comment { get; init; }
    public string? MumbleCertHash { get; init; }
    public bool IsSelf { get; init; }

    // ---- Server-owned. null means unknown, never "cleared".
    public string? MatrixUserId { get; init; }
    public string? CompanionId { get; init; }
    public bool? IsBrmbleClient { get; init; }
    public string? ServerCertHash { get; init; }

    /// <summary>
    /// The live connection's certificate wins over the server's recorded copy, so a server
    /// restart clearing its own copy cannot blank a hash Mumble can still see.
    /// </summary>
    public string? CertHash => MumbleCertHash ?? ServerCertHash;
}
