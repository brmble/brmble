namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// The single authoritative user projection. Merges Mumble presence and Brmble identity under
/// two rules: each input writes only the fields it owns, and a null server field means "not
/// known" rather than "cleared".
/// </summary>
/// <remarks>
/// Every Apply takes one lock, mutates, computes the change set and releases. No callback runs
/// under the lock — the caller emits from the returned value (spec §6.6). Inputs arrive on the
/// Mumble protocol thread, the WebSocket read loop and an HTTP continuation.
/// </remarks>
internal sealed class UserProjectionStore
{
    /// <summary>
    /// Ceiling on held server entries for sessions Mumble has not announced yet.
    /// </summary>
    /// <remarks>
    /// The map is fed by a remote server, so it cannot be unbounded. The legitimate population
    /// is "sessions on this Mumble server that the client has not seen a UserState for yet",
    /// which is at most the server's user count for the few hundred milliseconds between
    /// <c>/auth/token</c> resolving and the UserState batch arriving. 1024 is comfortably above
    /// any real Murmur deployment, so reaching it means the server is misbehaving rather than
    /// busy. Overflow evicts the oldest hold, because the newest statement is the one most
    /// likely to still be true.
    /// </remarks>
    internal const int MaxPendingEntries = 1024;

    private readonly object _gate = new();
    private readonly Dictionary<uint, UserProjection> _rows = [];

    /// <summary>
    /// Server-owned data for sessions that have no row yet. Consumed when the row appears.
    /// </summary>
    /// <remarks>
    /// Without this, server data for an unannounced session is lost with nothing to re-deliver
    /// it: no gap occurs, so no resync is triggered. The worst case is voice connect, where
    /// <c>/auth/token</c> routinely resolves before Mumble's UserState batch — every badge and
    /// companion for every user would be dropped on every connect.
    /// </remarks>
    private readonly Dictionary<uint, PendingEntry> _pending = [];
    private long _pendingSequence;

    private string? _instanceId;
    private long _revision;

    private readonly record struct PendingEntry(long Sequence, ServerMappingEntry Entry);

    /// <summary>A copy of the current projection, for tests and for building a full reset.</summary>
    public IReadOnlyDictionary<uint, UserProjection> Snapshot()
    {
        lock (_gate) return new Dictionary<uint, UserProjection>(_rows);
    }

    public ChangeSet ApplyMumbleUserState(MumbleUserInput input)
    {
        lock (_gate)
        {
            _rows.TryGetValue(input.SessionId, out var existing);
            var updated = WithMumbleFields(existing, input);

            // A row appearing for the first time claims anything the server said about it
            // while it did not exist.
            if (existing is null) updated = TakePending(input.SessionId, updated);

            if (existing == updated) return ChangeSet.Empty;

            _rows[input.SessionId] = updated;
            return new ChangeSet([updated], []);
        }
    }

    public ChangeSet ApplyMumbleUserRemove(uint sessionId)
    {
        lock (_gate)
        {
            // Mumble alone owns existence, so this is the only path that deletes a row.
            return _rows.Remove(sessionId)
                ? new ChangeSet([], [sessionId])
                : ChangeSet.Empty;
        }
    }

    /// <summary>
    /// Replaces membership wholesale on voice connect or reconnect. Server-owned fields survive
    /// for sessions present in both the old and new list, and sessions appearing for the first
    /// time claim any held server data.
    /// </summary>
    public ChangeSet ApplyMumbleReset(IReadOnlyList<MumbleUserInput> users)
    {
        lock (_gate)
        {
            var rebuilt = new Dictionary<uint, UserProjection>(users.Count);
            foreach (var input in users)
            {
                _rows.TryGetValue(input.SessionId, out var existing);
                var row = WithMumbleFields(existing, input);
                if (existing is null) row = TakePending(input.SessionId, row);
                rebuilt[input.SessionId] = row;
            }

            _rows.Clear();
            foreach (var (sessionId, row) in rebuilt) _rows[sessionId] = row;

            return new ChangeSet([.. rebuilt.Values], [], IsReset: true);
        }
    }

    /// <summary>
    /// Writes only Mumble-owned fields. Server-owned fields are carried across untouched, which
    /// is why a channel move cannot blank a badge.
    /// </summary>
    private static UserProjection WithMumbleFields(UserProjection? existing, MumbleUserInput input)
    {
        var row = existing ?? new UserProjection { SessionId = input.SessionId };
        return row with
        {
            Name = input.Name,
            ChannelId = input.ChannelId,
            Muted = input.Muted,
            Deafened = input.Deafened,
            Comment = input.Comment,
            MumbleCertHash = input.CertHash,
            IsSelf = input.IsSelf
        };
    }

    /// <summary>
    /// Consumes any held server data for a newly created row. The hold is removed: it has done
    /// its job, and a session that later leaves and rejoins must be re-enriched by the server
    /// rather than by a stale hold.
    /// </summary>
    private UserProjection TakePending(uint sessionId, UserProjection row)
    {
        if (!_pending.Remove(sessionId, out var held)) return row;
        return WithServerFields(row, held.Entry);
    }

    /// <summary>
    /// Holds server data for a session with no row, merging under the null-means-unknown rule
    /// so a later partial event cannot blank what an earlier one established.
    /// </summary>
    private void HoldPending(uint sessionId, ServerMappingEntry delta)
    {
        if (_pending.TryGetValue(sessionId, out var held))
        {
            _pending[sessionId] = held with { Entry = MergeEntries(held.Entry, delta) };
            return;
        }

        EvictOldestPendingIfFull();
        _pending[sessionId] = new PendingEntry(_pendingSequence++, delta);
    }

    private void EvictOldestPendingIfFull()
    {
        if (_pending.Count < MaxPendingEntries) return;

        var oldest = _pending.MinBy(p => p.Value.Sequence).Key;
        _pending.Remove(oldest);
    }

    private static ServerMappingEntry MergeEntries(ServerMappingEntry existing, ServerMappingEntry delta) =>
        new(delta.MatrixUserId ?? existing.MatrixUserId,
            delta.CompanionId ?? existing.CompanionId,
            delta.IsBrmbleClient ?? existing.IsBrmbleClient,
            delta.CertHash ?? existing.CertHash);

    /// <summary>
    /// Applies a complete statement of server-known sessions. Sessions the snapshot omits have
    /// their server-owned fields reset to unknown — stale enrichment is worse than none — but
    /// their rows survive, because only Mumble owns existence.
    /// </summary>
    public ChangeSet ApplyServerSnapshot(ServerSnapshot snapshot)
    {
        lock (_gate)
        {
            // A different instance means the old revision line is meaningless. Nothing special
            // is needed beyond taking this snapshot as truth, which the reset below does.
            _instanceId = snapshot.InstanceId;
            _revision = snapshot.Revision;

            var changed = new List<UserProjection>();

            foreach (var sessionId in _rows.Keys.ToArray())
            {
                var existing = _rows[sessionId];

                var updated = snapshot.Mappings.TryGetValue(sessionId, out var entry)
                    // Present: overwrite the server half outright. A snapshot states every
                    // server-owned field, so null here is knowledge, not absence — this is the
                    // one place the null-means-unknown rule does not apply.
                    ? existing with
                    {
                        MatrixUserId = entry.MatrixUserId,
                        CompanionId = entry.CompanionId,
                        IsBrmbleClient = entry.IsBrmbleClient,
                        ServerCertHash = entry.CertHash
                    }
                    // Absent: the server does not know this session. Back to unknown.
                    : existing with
                    {
                        MatrixUserId = null,
                        CompanionId = null,
                        IsBrmbleClient = null,
                        ServerCertHash = null
                    };

                if (existing == updated) continue;
                _rows[sessionId] = updated;
                changed.Add(updated);
            }

            // The snapshot is authoritative for membership, so it replaces the held set outright
            // rather than merging into it. Holds it omits are superseded and dropped; entries it
            // carries for sessions Mumble has not announced are held for when they appear —
            // which on voice connect is every session.
            RebuildPendingFrom(snapshot);

            return changed.Count == 0 ? ChangeSet.Empty : new ChangeSet(changed, []);
        }
    }

    private void RebuildPendingFrom(ServerSnapshot snapshot)
    {
        _pending.Clear();
        foreach (var (sessionId, entry) in snapshot.Mappings)
        {
            if (_rows.ContainsKey(sessionId)) continue;
            EvictOldestPendingIfFull();
            _pending[sessionId] = new PendingEntry(_pendingSequence++, entry);
        }
    }

    /// <summary>
    /// Writes only server-owned fields, and only those the input actually knows: a null leaves
    /// the current value alone. This is the rule that stops a missing field becoming a wrong one.
    /// </summary>
    private static UserProjection WithServerFields(UserProjection row, ServerMappingEntry entry) =>
        row with
        {
            MatrixUserId = entry.MatrixUserId ?? row.MatrixUserId,
            CompanionId = entry.CompanionId ?? row.CompanionId,
            IsBrmbleClient = entry.IsBrmbleClient ?? row.IsBrmbleClient,
            ServerCertHash = entry.CertHash ?? row.ServerCertHash
        };

    /// <summary>
    /// The server-owned change an event asserts, expressed as an entry so that the row path and
    /// the hold path apply identical semantics. Activation and deactivation are knowledge, so
    /// they carry a real bool rather than a null.
    /// </summary>
    private static ServerMappingEntry? DeltaFor(ServerEvent evt) => evt.Kind switch
    {
        ServerEventKind.BrmbleActivated => new ServerMappingEntry(null, null, true, null),
        ServerEventKind.BrmbleDeactivated => new ServerMappingEntry(null, null, false, null),
        _ => evt.Entry
    };

    /// <summary>
    /// Applies one incremental server event, or reports that a snapshot is needed.
    /// </summary>
    /// <remarks>
    /// Sequencing uses <c>BaseRevision</c>, not <c>Revision - 1</c>: a single server operation
    /// may bump the counter several times, so only the range's start tells us whether we are
    /// contiguous. An event that cannot be applied changes nothing at all — a partially applied
    /// gap is what produces a confidently wrong row.
    /// </remarks>
    public ChangeSet ApplyServerEvent(ServerEvent evt)
    {
        lock (_gate)
        {
            // No cursor yet: nothing to sequence against, so ask for the snapshot that
            // establishes one.
            if (_instanceId is null)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // The server restarted. Everything it told us belongs to a table that no longer
            // exists, so take nothing from this event and resync.
            if (!string.Equals(evt.InstanceId, _instanceId, StringComparison.Ordinal))
                return new ChangeSet([], [], NeedsSnapshot: true);

            // A range that ends before it starts is malformed. The server should never emit one,
            // but the store is the trust boundary: applying it would drag the cursor backwards
            // and make every subsequent event look like a duplicate. Treat it as a gap.
            if (evt.Revision < evt.BaseRevision)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // Already reflected — a duplicate or a reorder. Silently correct.
            if (evt.BaseRevision < _revision) return ChangeSet.Empty;

            // A genuine gap: we missed something in between and cannot infer it.
            if (evt.BaseRevision > _revision)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // Contiguous. Advance the cursor even if the event turns out not to touch a row we
            // hold, or the next event would look like a gap.
            _revision = evt.Revision;

            if (!_rows.TryGetValue(evt.SessionId, out var existing))
            {
                // No row yet. Hold what the event said rather than dropping it — Mumble may
                // simply not have announced this session to us yet.
                if (evt.Kind == ServerEventKind.MappingRemoved) _pending.Remove(evt.SessionId);
                else if (DeltaFor(evt) is { } delta) HoldPending(evt.SessionId, delta);

                return ChangeSet.Empty;
            }

            var updated = evt.Kind switch
            {
                ServerEventKind.MappingRemoved => existing with
                {
                    MatrixUserId = null,
                    CompanionId = null,
                    IsBrmbleClient = null,
                    ServerCertHash = null
                },
                // Everything else carries a partial entry: null means unknown, so leave it.
                _ => DeltaFor(evt) is { } delta ? WithServerFields(existing, delta) : existing
            };

            if (existing == updated) return ChangeSet.Empty;

            _rows[evt.SessionId] = updated;
            return new ChangeSet([updated], []);
        }
    }
}
