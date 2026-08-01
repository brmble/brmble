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
    private readonly object _gate = new();
    private readonly Dictionary<uint, UserProjection> _rows = [];

    private string? _instanceId;
    private long _revision;

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
    /// for sessions present in both the old and new list.
    /// </summary>
    public ChangeSet ApplyMumbleReset(IReadOnlyList<MumbleUserInput> users)
    {
        lock (_gate)
        {
            var rebuilt = new Dictionary<uint, UserProjection>(users.Count);
            foreach (var input in users)
            {
                _rows.TryGetValue(input.SessionId, out var existing);
                rebuilt[input.SessionId] = WithMumbleFields(existing, input);
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

            return changed.Count == 0 ? ChangeSet.Empty : new ChangeSet(changed, []);
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

            // Already reflected — a duplicate or a reorder. Silently correct.
            if (evt.BaseRevision < _revision) return ChangeSet.Empty;

            // A genuine gap: we missed something in between and cannot infer it.
            if (evt.BaseRevision > _revision)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // Contiguous. Advance the cursor even if the event turns out not to touch a row we
            // hold, or the next event would look like a gap.
            _revision = evt.Revision;

            if (!_rows.TryGetValue(evt.SessionId, out var existing))
                return ChangeSet.Empty;

            var updated = evt.Kind switch
            {
                ServerEventKind.MappingRemoved => existing with
                {
                    MatrixUserId = null,
                    CompanionId = null,
                    IsBrmbleClient = null,
                    ServerCertHash = null
                },
                // Activation and deactivation are both knowledge, so they write a real bool.
                ServerEventKind.BrmbleActivated => existing with { IsBrmbleClient = true },
                ServerEventKind.BrmbleDeactivated => existing with { IsBrmbleClient = false },
                // Everything else carries a partial entry: null means unknown, so leave it.
                _ => evt.Entry is null ? existing : WithServerFields(existing, evt.Entry)
            };

            if (existing == updated) return ChangeSet.Empty;

            _rows[evt.SessionId] = updated;
            return new ChangeSet([updated], []);
        }
    }
}
