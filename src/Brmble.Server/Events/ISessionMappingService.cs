namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool? IsBrmbleClient = null, string? CertHash = null);

public interface ISessionMappingService
{
    /// <summary>
    /// Identifies this process's mapping table. Regenerated on every start, so a client that
    /// sees a different value knows the server restarted and its cached server-owned fields
    /// are worthless.
    /// </summary>
    string InstanceId { get; }

    /// <summary>
    /// Monotonic counter, incremented once per successful mutation. Stamped on every payload so
    /// a client can order and deduplicate events.
    /// </summary>
    /// <remarks>
    /// One logical operation may increment this several times — a first registration does add,
    /// certHash and brmbleStatus under a single announcement, moving it by three — so
    /// <c>revision == last + 1</c> is <b>not</b> a valid gap test. Phase 2 stamps the range's
    /// start alongside it (<c>baseRevision</c>) precisely so a client can distinguish a
    /// multi-bump operation from a genuine gap.
    /// </remarks>
    long Revision { get; }

    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    bool TryGetSessionByUserId(long userId, out int sessionId);
    bool TryGetMappingByUserId(long userId, out int sessionId, out SessionMapping? mapping);
    bool TryUpdateCompanionId(int sessionId, string companionId);

    /// <summary>
    /// Compare-and-swap on the companion field.
    /// </summary>
    /// <remarks>
    /// Retained deliberately (spec §4.4 proposed retiring it). Revision rejection guards a client
    /// submitting a mutation against a table it has since fallen behind. This guards a different
    /// race entirely: a moderator deleting a custom companion resets every affected session to
    /// <c>"floppy"</c> while an affected user may concurrently be selecting something else.
    /// Neither party carries a client revision — <c>CustomCompanionEndpoints</c> computes its
    /// target inside <c>PublishAsync</c>'s own gate — so there is no stale revision for the
    /// revision path to reject. The two do not overlap.
    ///
    /// The CAS also gates the announcement: <c>PublishAsync</c> publishes only when the mutation
    /// returns true, so a refused reset emits no <c>companionChanged</c> and therefore cannot
    /// overwrite the user's newer choice on every other client.
    /// </remarks>
    bool TryUpdateCompanionIdIfCurrent(int sessionId, string expectedCompanionId, string companionId);
    bool TryUpdateCompanionIdIfOwnedBy(int sessionId, long userId, string companionId);
    bool TryUpdateBrmbleStatus(int sessionId, bool? isBrmbleClient);
    bool TryUpdateCertHash(int sessionId, string certHash);

    /// <summary>
    /// Marks a session as an active Brmble client and records its certificate hash, but only if
    /// the session still belongs to <paramref name="userId"/>.
    /// </summary>
    /// <remarks>
    /// Atomic and ownership-constrained on purpose. Doing this as separate
    /// <see cref="TryUpdateBrmbleStatus"/> and <see cref="TryUpdateCertHash"/> calls guarded by a
    /// later ownership check writes one user's certificate and status into another user's
    /// mapping whenever a session is recycled in between, and then suppresses the announcement —
    /// corrupting the projection and leaving unannounced revision bumps behind. It is also one
    /// bump rather than two, so the announced range covers exactly this change.
    /// </remarks>
    /// <param name="mapping">The post-claim mapping to announce, or null if the claim was refused.</param>
    bool TryClaimBrmbleSession(int sessionId, long userId, string certHash, out SessionMapping? mapping);

    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
