using System.Collections.Concurrent;

namespace Brmble.Server.Paint;

public sealed class PaintAuthorizationException(string message) : Exception(message);
public sealed class PaintConflictException(string message) : Exception(message);
public sealed class PaintNotFoundException(string message) : Exception(message);

public sealed record CreatePaintSessionResult(Guid SessionId, string MatrixRoomId);
public sealed record PaintSourceAttachedResult(PaintSource Source, long Revision, long Generation);
public sealed record PaintParticipantChangeResult(PaintParticipant Participant, long Revision, long Generation);
public sealed record PaintStrokeCommittedResult(PaintStroke Stroke, long Revision, long Generation);
public sealed record PaintPreviewResult(bool Published, long Generation);
public sealed record PaintStrokeUndoneResult(Guid UndoneStrokeId, long Revision, long Generation);
public sealed record PaintCanvasClearedResult(long Generation, long Revision);
public sealed record PaintSessionEndedResult(PaintSessionStatus Status, long Revision, long Generation);

public sealed class PaintSessionManager(
    IPaintPresence presence,
    IPaintEventPublisher publisher,
    IMatrixPaintService matrixPaintService,
    MatrixPaintSourceResolver sourceResolver,
    PaintRoomCleanupRepository cleanupRepository,
    PaintRateLimiter rateLimiter,
    Func<DateTimeOffset>? utcNow = null) : IPaintParticipationLifecycle
{
    private static readonly TimeSpan SessionTimeout = TimeSpan.FromMinutes(30);
    private readonly ConcurrentDictionary<Guid, LivePaintSession> _sessions = [];
    private readonly Func<DateTimeOffset> _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);

    private sealed class LivePaintSession
    {
        public required Guid SessionId;
        public required int ChannelId;
        public required long HostUserId;
        public required string MatrixRoomId;
        public required Dictionary<long, PaintInvitee> Invitees;
        public required Dictionary<long, PaintParticipant> Participants;
        public PaintSource? Source;
        public PaintSessionStatus Status = PaintSessionStatus.PendingSource;
        public long Generation;
        public long Revision;
        public long NextSequence;
        public DateTimeOffset LastActivity;
        public long ActivityVersion;
        public readonly List<PaintStroke> Strokes = [];
        public readonly Dictionary<(long UserId, Guid CorrelationId), PaintStroke> IdempotentCommits = [];
        public readonly Dictionary<long, PaintStrokeInput> Previews = [];
        public Task PermanentPublishTail = Task.CompletedTask;
        public readonly SemaphoreSlim TerminalTransitionGate = new(1, 1);
        public readonly object Lock = new();
    }

    public async Task<CreatePaintSessionResult> CreateAsync(long hostUserId, IReadOnlyList<int> selectedMumbleSessionIds, CancellationToken cancellationToken = default)
    {
        if (!presence.TryGetParticipant(hostUserId, out var host)) throw new PaintAuthorizationException("Host is not connected.");
        var invitees = new Dictionary<long, PaintInvitee>
        {
            [host.UserId] = new PaintInvitee(host.UserId, host.MatrixUserId),
        };

        foreach (var mumbleSessionId in selectedMumbleSessionIds.Distinct())
        {
            if (!presence.TryGetParticipantByMumbleSessionId(mumbleSessionId, out var selected) || selected.ChannelId != host.ChannelId)
                throw new PaintAuthorizationException("Selected users must be connected to the host channel.");
            invitees[selected.UserId] = new PaintInvitee(selected.UserId, selected.MatrixUserId);
        }

        var participants = new Dictionary<long, PaintParticipant>
        {
            [host.UserId] = new PaintParticipant(host.UserId, host.MumbleSessionId, host.MatrixUserId),
        };

        var roomId = await matrixPaintService.CreatePaintRoomAsync($"Paint {host.ChannelId}", invitees.Values.Select(p => p.MatrixUserId).ToArray(), cancellationToken);
        var sessionId = Guid.NewGuid();
        _sessions[sessionId] = new LivePaintSession { SessionId = sessionId, ChannelId = host.ChannelId, HostUserId = hostUserId, MatrixRoomId = roomId, Invitees = invitees, Participants = participants, LastActivity = _utcNow() };
        return new CreatePaintSessionResult(sessionId, roomId);
    }

    public async Task<PaintSourceAttachedResult> AttachSourceAsync(Guid sessionId, long userId, string sourceEventId, CancellationToken cancellationToken = default)
    {
        var session = GetSession(sessionId);
        string roomId;
        string hostMatrixUserId;
        lock (session.Lock)
        {
            RequireCurrentHost(session, userId); RequirePendingSource(session);
            roomId = session.MatrixRoomId;
            hostMatrixUserId = RequireCurrentParticipant(session, userId).MatrixUserId;
        }
        var source = await sourceResolver.ResolveAsync(roomId, hostMatrixUserId, sourceEventId, cancellationToken);
        long revision, generation;
        Task publish;
        lock (session.Lock)
        {
            RequireCurrentHost(session, userId); RequirePendingSource(session);
            session.Source = source; session.Status = PaintSessionStatus.Active; session.Revision++; Touch(session);
            revision = session.Revision; generation = session.Generation;
            var participants = CurrentParticipantUserIds(session);
            var invitees = session.Invitees.Keys.ToHashSet();
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(participants,
                new { type = PaintEventNames.SourceAttached, sessionId, source, revision, generation }));
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(invitees,
                new { type = PaintEventNames.Invited, sessionId, channelId = session.ChannelId, hostUserId = session.HostUserId, status = session.Status }));
        }
        await publish;
        return new PaintSourceAttachedResult(source, revision, generation);
    }

    public async Task<PaintParticipantChangeResult> JoinAsync(Guid sessionId, long userId, CancellationToken cancellationToken = default)
    {
        var session = GetSession(sessionId);
        if (!presence.TryGetParticipant(userId, out var current) || current.ChannelId != session.ChannelId) throw new PaintAuthorizationException("You must be in the paint channel.");
        PaintInvitee invitee;
        lock (session.Lock)
        {
            RequireOpen(session);
            invitee = GetInvitee(session, userId);
            if (IsCurrentParticipant(session, userId, out var existing))
                return new PaintParticipantChangeResult(existing, session.Revision, session.Generation);
        }
        var membership = await matrixPaintService.GetMembershipAsync(session.MatrixRoomId, invitee.MatrixUserId, cancellationToken);
        if (!string.Equals(membership, "join", StringComparison.OrdinalIgnoreCase))
        {
            await matrixPaintService.InvitePaintUserAsync(session.MatrixRoomId, invitee.MatrixUserId, cancellationToken);
            throw new PaintAuthorizationException("Join the Matrix paint room before joining the canvas.");
        }
        long revision, generation;
        Task publish;
        PaintParticipant participant;
        lock (session.Lock)
        {
            RequireOpen(session);
            if (!presence.TryGetParticipant(userId, out var confirmed)
                || confirmed.ChannelId != session.ChannelId
                || confirmed.MumbleSessionId != current.MumbleSessionId)
                throw new PaintAuthorizationException("Your voice connection changed; join paint again.");
            participant = new PaintParticipant(userId, confirmed.MumbleSessionId, invitee.MatrixUserId);
            session.Participants[userId] = participant; session.Previews.Remove(userId); session.Revision++; Touch(session);
            revision = session.Revision; generation = session.Generation;
            var recipients = CurrentParticipantUserIds(session);
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                new { type = PaintEventNames.ParticipantJoined, sessionId, participant, revision, generation }));
        }
        await publish;
        return new PaintParticipantChangeResult(participant, revision, generation);
    }

    public async Task<PaintParticipantChangeResult> LeaveAsync(Guid sessionId, long userId)
    {
        var session = GetSession(sessionId); PaintParticipant participant; long revision, generation; Task publish;
        lock (session.Lock)
        {
            RequireOpen(session);
            participant = RequireCurrentParticipant(session, userId);
            session.Participants.Remove(userId);
            session.Previews.Remove(userId); session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
            var recipients = CurrentParticipantUserIds(session);
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                new { type = PaintEventNames.ParticipantLeft, sessionId, participant, revision, generation }));
        }
        await publish;
        return new PaintParticipantChangeResult(participant, revision, generation);
    }

    public async Task<PaintStrokeCommittedResult> CommitStrokeAsync(Guid sessionId, long userId, PaintStrokeInput input)
    {
        var session = GetSession(sessionId); PaintStroke stroke; long revision, generation; Task publish;
        lock (session.Lock)
        {
            RequireActive(session); var participant = RequireCurrentParticipant(session, userId);
            if (input.Generation != session.Generation) throw new PaintConflictException("Canvas generation is stale.");
            var valid = PaintValidation.ValidateStrokeInput(input);
            if (session.IdempotentCommits.TryGetValue((userId, valid.CorrelationId), out stroke!)) return new PaintStrokeCommittedResult(stroke, session.Revision, session.Generation);
            stroke = new PaintStroke(Guid.NewGuid(), valid.CorrelationId, userId, participant.MatrixUserId, ++session.NextSequence, session.Generation, valid.Tool, valid.Color, valid.Width, valid.Points, true);
            session.Strokes.Add(stroke); session.IdempotentCommits[(userId, valid.CorrelationId)] = stroke; session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
            var recipients = CurrentParticipantUserIds(session);
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                new { type = PaintEventNames.StrokeCommitted, sessionId, stroke, revision, generation }));
        }
        await publish;
        return new PaintStrokeCommittedResult(stroke, revision, generation);
    }

    public async Task<PaintPreviewResult> PreviewAsync(Guid sessionId, long userId, PaintStrokeInput input)
    {
        var session = GetSession(sessionId); long generation; PaintParticipant participant;
        IReadOnlySet<long> recipients;
        lock (session.Lock)
        {
            RequireActive(session); participant = RequireCurrentParticipant(session, userId);
            if (input.Generation != session.Generation) throw new PaintConflictException("Canvas generation is stale.");
            input = PaintValidation.ValidateStrokeInput(input); generation = session.Generation; Touch(session);
            if (!rateLimiter.TryAcquire(sessionId, userId, _utcNow())) return new PaintPreviewResult(false, generation);
            session.Previews[userId] = input;
            recipients = CurrentParticipantUserIds(session);
        }
        await publisher.PublishPreviewToUsersAsync(recipients, sessionId, participant.UserId,
            new { type = PaintEventNames.PreviewUpdated, sessionId, generation,
            authorUserId = participant.UserId, authorMatrixUserId = participant.MatrixUserId, input });
        return new PaintPreviewResult(true, generation);
    }

    public async Task<PaintStrokeUndoneResult> UndoAsync(Guid sessionId, long userId)
    {
        var session = GetSession(sessionId); PaintStroke undone; long revision, generation; Task publish;
        lock (session.Lock)
        {
            RequireActive(session); RequireCurrentParticipant(session, userId);
            undone = session.Strokes.LastOrDefault(s => s.AuthorUserId == userId && s.Generation == session.Generation && s.Active)
                ?? throw new PaintConflictException("No active stroke to undo.");
            undone = undone with { Active = false }; session.Strokes[session.Strokes.FindIndex(s => s.Id == undone.Id)] = undone;
            session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
            var recipients = CurrentParticipantUserIds(session);
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                new { type = PaintEventNames.StrokeUndone, sessionId, undoneStrokeId = undone.Id, revision, generation }));
        }
        await publish;
        return new PaintStrokeUndoneResult(undone.Id, revision, generation);
    }

    public async Task<PaintCanvasClearedResult> ClearAsync(Guid sessionId, long userId)
    {
        var session = GetSession(sessionId); long revision, generation; Task publish;
        lock (session.Lock)
        {
            RequireCurrentHost(session, userId); RequireActive(session); session.Generation++; session.Previews.Clear(); session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
            var recipients = CurrentParticipantUserIds(session);
            publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                new { type = PaintEventNames.CanvasCleared, sessionId, revision, generation }));
        }
        await publish;
        return new PaintCanvasClearedResult(generation, revision);
    }

    public async Task<PaintSessionEndedResult> EndAsync(Guid sessionId, long userId, CancellationToken cancellationToken = default)
    {
        var session = GetSession(sessionId);
        await session.TerminalTransitionGate.WaitAsync(cancellationToken);
        try
        {
            string roomId;
            lock (session.Lock)
            {
                RequireCurrentHost(session, userId); RequireOpen(session); roomId = session.MatrixRoomId;
            }

            await cleanupRepository.RecordPendingAsync(sessionId, roomId, cancellationToken);

            long revision, generation;
            Task publish;
            lock (session.Lock)
            {
                RequireCurrentHost(session, userId); RequireOpen(session); session.Status = PaintSessionStatus.Ended; session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
                publish = EnqueuePermanentPublish(session, () => publisher.PublishToChannelAsync(session.ChannelId,
                    new { type = PaintEventNames.SessionEnded, sessionId, status = session.Status, revision, generation }));
            }
            await publish;
            return new PaintSessionEndedResult(PaintSessionStatus.Ended, revision, generation);
        }
        finally
        {
            session.TerminalTransitionGate.Release();
        }
    }

    public Task<PaintSessionSummary> SummaryAsync(Guid sessionId, long userId)
    {
        var session = GetSession(sessionId);
        if (!presence.TryGetParticipant(userId, out var current)
            || current.ChannelId != session.ChannelId)
            throw new PaintAuthorizationException("You must be in the paint channel.");

        lock (session.Lock)
        {
            var canJoin = session.Invitees.ContainsKey(userId);
            var isParticipant = canJoin && IsCurrentParticipant(session, userId, out _);
            return Task.FromResult(new PaintSessionSummary(
                session.SessionId,
                session.ChannelId,
                session.HostUserId,
                session.Status,
                canJoin,
                isParticipant));
        }
    }

    public async Task<PaintSessionSnapshot> SnapshotAsync(Guid sessionId, long userId)
    {
        if (!_sessions.TryGetValue(sessionId, out var session))
        {
            await publisher.PublishToUsersAsync(new HashSet<long> { userId }, new
            {
                type = PaintEventNames.SessionUnavailable,
                sessionId,
                status = PaintSessionStatus.Unavailable,
                revision = 0L,
                generation = 0L,
            });
            throw new PaintNotFoundException("Paint session was not found.");
        }
        lock (session.Lock)
        {
            _ = RequireCurrentParticipant(session, userId);
            return new PaintSessionSnapshot(session.SessionId, session.ChannelId, session.MatrixRoomId, session.Source?.SourceEventId, session.HostUserId,
                userId, session.HostUserId == userId, session.Status, session.Generation, session.Revision, session.LastActivity + SessionTimeout, session.Source,
                session.Participants.Values.Where(participant => IsCurrentParticipant(session, participant.UserId, out _)).ToArray(),
                session.Strokes.Where(s => s.Generation == session.Generation && s.Active).ToArray());
        }
    }

    public Task ExpireInactiveForTestAsync() => ExpireInactiveAsync(CancellationToken.None);

    internal async Task ExpireInactiveAsync(CancellationToken cancellationToken)
    {
        foreach (var session in _sessions.Values)
        {
            await session.TerminalTransitionGate.WaitAsync(cancellationToken);
            try
            {
                string roomId;
                long activityVersion;
                lock (session.Lock)
                {
                    if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired || session.LastActivity + SessionTimeout > _utcNow()) continue;
                    roomId = session.MatrixRoomId; activityVersion = session.ActivityVersion;
                }

                await cleanupRepository.RecordPendingAsync(session.SessionId, roomId, cancellationToken);

                long revision, generation;
                var publish = Task.CompletedTask;
                var expiryCancelled = false;
                lock (session.Lock)
                {
                    if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired || session.ActivityVersion != activityVersion || session.LastActivity + SessionTimeout > _utcNow())
                        expiryCancelled = true;
                    else
                    {
                        session.Status = PaintSessionStatus.Expired; session.Revision++; revision = session.Revision; generation = session.Generation;
                        publish = EnqueuePermanentPublish(session, () => publisher.PublishToChannelAsync(session.ChannelId,
                            new { type = PaintEventNames.SessionExpired, sessionId = session.SessionId, status = session.Status, revision, generation }));
                    }
                }
                if (expiryCancelled)
                {
                    await cleanupRepository.DeletePendingAsync(session.SessionId, roomId, cancellationToken);
                    continue;
                }
                await publish;
            }
            finally
            {
                session.TerminalTransitionGate.Release();
            }
        }
    }

    private static Task EnqueuePermanentPublish(LivePaintSession session, Func<Task> publish)
    {
        session.PermanentPublishTail = PublishAfterAsync(session.PermanentPublishTail, publish);
        return session.PermanentPublishTail;
    }

    private static async Task PublishAfterAsync(Task previous, Func<Task> publish)
    {
        try
        {
            await previous.ConfigureAwait(false);
        }
        catch
        {
            // A failed delivery must not prevent later permanent state from being published.
        }

        await publish().ConfigureAwait(false);
    }

    public Task HandleSessionDisconnectedAsync(int mumbleSessionId) =>
        DeactivateMumbleSessionAsync(mumbleSessionId);

    public Task HandleSessionChannelChangedAsync(int mumbleSessionId, int previousChannelId, int currentChannelId) =>
        previousChannelId == currentChannelId
            ? Task.CompletedTask
            : DeactivateMumbleSessionAsync(mumbleSessionId);

    private async Task DeactivateMumbleSessionAsync(int mumbleSessionId)
    {
        foreach (var session in _sessions.Values)
        {
            PaintParticipant? participant = null;
            Task publish = Task.CompletedTask;
            lock (session.Lock)
            {
                participant = session.Participants.Values.FirstOrDefault(candidate => candidate.MumbleSessionId == mumbleSessionId);
                if (participant is null) continue;

                session.Participants.Remove(participant.UserId);
                session.Previews.Remove(participant.UserId);
                session.Revision++;
                Touch(session);
                var revision = session.Revision;
                var generation = session.Generation;
                var recipients = CurrentParticipantUserIds(session);
                publish = EnqueuePermanentPublish(session, () => publisher.PublishToUsersAsync(recipients,
                    new { type = PaintEventNames.ParticipantLeft, sessionId = session.SessionId, participant, revision, generation }));
            }
            await publish;
        }
    }

    private LivePaintSession GetSession(Guid sessionId) => _sessions.TryGetValue(sessionId, out var session) ? session : throw new PaintNotFoundException("Paint session was not found.");
    private static PaintInvitee GetInvitee(LivePaintSession session, long userId) => session.Invitees.TryGetValue(userId, out var invitee) ? invitee : throw new PaintAuthorizationException("You are not selected for this paint session.");
    private bool IsCurrentParticipant(LivePaintSession session, long userId, out PaintParticipant participant)
    {
        participant = null!;
        if (!session.Participants.TryGetValue(userId, out var stored)
            || !presence.TryGetParticipant(userId, out var current)
            || current.ChannelId != session.ChannelId
            || current.MumbleSessionId != stored.MumbleSessionId)
            return false;

        participant = stored;
        return true;
    }

    private PaintParticipant RequireCurrentParticipant(LivePaintSession session, long userId) =>
        IsCurrentParticipant(session, userId, out var participant)
            ? participant
            : throw new PaintAuthorizationException("You have not joined the paint session.");

    private IReadOnlySet<long> CurrentParticipantUserIds(LivePaintSession session) =>
        session.Participants.Keys.Where(userId => IsCurrentParticipant(session, userId, out _)).ToHashSet();

    private void RequireCurrentHost(LivePaintSession session, long userId)
    {
        if (session.HostUserId != userId) throw new PaintAuthorizationException("Only the host can perform this action.");
        _ = RequireCurrentParticipant(session, userId);
    }

    private static void RequireOpen(LivePaintSession session) { if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired) throw new PaintConflictException("Paint session is no longer open."); }
    private static void RequirePendingSource(LivePaintSession session) { if (session.Status != PaintSessionStatus.PendingSource) throw new PaintConflictException("Paint source is already attached."); }
    private static void RequireActive(LivePaintSession session) { if (session.Status != PaintSessionStatus.Active) throw new PaintConflictException("Paint session is not active."); }
    private void Touch(LivePaintSession session) { session.LastActivity = _utcNow(); session.ActivityVersion++; }
}
