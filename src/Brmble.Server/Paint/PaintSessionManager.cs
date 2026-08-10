using System.Collections.Concurrent;

namespace Brmble.Server.Paint;

public sealed class PaintAuthorizationException(string message) : Exception(message);
public sealed class PaintConflictException(string message) : Exception(message);
public sealed class PaintNotFoundException(string message) : Exception(message);

public sealed record CreatePaintSessionResult(Guid SessionId, int ChannelId);
public sealed record PaintSourceDownloadResult(PaintSource Source, byte[] Bytes);
public sealed record PaintParticipantChangeResult(PaintParticipant Participant, long Revision, long Generation);
public sealed record PaintStrokeCommittedResult(PaintStroke Stroke, long Revision, long Generation);
public sealed record PaintPreviewResult(bool Published, long Generation);
public sealed record PaintStrokeUndoneResult(Guid UndoneStrokeId, long Revision, long Generation);
public sealed record PaintCanvasClearedResult(long Generation, long Revision);
public sealed record PaintSessionEndedResult(PaintSessionStatus Status, long Revision, long Generation);

public sealed class PaintSessionManager(
    IPaintPresence presence,
    IPaintEventPublisher publisher,
    PaintSourceValidator sourceValidator,
    IPaintTemporarySourceStore sourceStore,
    PaintTemporaryCleanupRepository cleanupRepository,
    PaintRateLimiter rateLimiter,
    Func<DateTimeOffset>? utcNow = null,
    ILogger<PaintSessionManager>? logger = null) : IPaintParticipationLifecycle, IPaintTemporaryDataLifetime
{
    private static readonly TimeSpan SessionTimeout = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan TerminalSessionRetention = TimeSpan.FromMinutes(5);
    private const int MaxStrokesPerSession = 500;
    private const int MaxOpenSessionsPerUser = 3;
    private readonly ConcurrentDictionary<Guid, LivePaintSession> _sessions = [];
    private readonly Dictionary<long, int> _openSessionCounts = [];
    private readonly object _openSessionCountsLock = new();
    private readonly Func<DateTimeOffset> _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);

    private sealed class LivePaintSession
    {
        public required Guid SessionId;
        public required int ChannelId;
        public required long HostUserId;
        public required Dictionary<long, PaintParticipant> Participants;
        public PaintSource? Source;
        public PaintSessionStatus Status = PaintSessionStatus.PendingSource;
        public long Generation;
        public long Revision;
        public long NextSequence;
        public DateTimeOffset LastActivity;
        public long ActivityVersion;
        public DateTimeOffset? TerminalAt;
        public readonly List<PaintStroke> Strokes = [];
        public readonly Dictionary<(long UserId, Guid CorrelationId), PaintStroke> IdempotentCommits = [];
        public readonly Dictionary<long, PaintStrokeInput> Previews = [];
        public Task PermanentPublishTail = Task.CompletedTask;
        public readonly SemaphoreSlim TerminalTransitionGate = new(1, 1);
        public readonly object Lock = new();
    }

    public async Task<CreatePaintSessionResult> CreateAsync(long hostUserId, string sourceMimeType, ReadOnlyMemory<byte> sourceBytes, CancellationToken cancellationToken = default)
    {
        if (!presence.TryGetParticipant(hostUserId, out var host)) throw new PaintAuthorizationException("Host is not connected.");
        var sourceMetadata = sourceValidator.Validate(sourceMimeType, sourceBytes.Span);

        ReserveOpenSessionSlot(hostUserId);
        var sessionId = Guid.NewGuid();
        var session = new LivePaintSession
        {
            SessionId = sessionId,
            ChannelId = host.ChannelId,
            HostUserId = hostUserId,
            Participants = new() { [hostUserId] = new PaintParticipant(hostUserId, host.MumbleSessionId, host.MatrixUserId) },
            LastActivity = _utcNow(),
        };
        _sessions[sessionId] = session;
        try
        {
            await sourceStore.WriteAsync(sessionId, sourceBytes, cancellationToken);
            lock (session.Lock)
            {
                session.Source = new PaintSource(sourceMetadata.MimeType, sourceMetadata.Width, sourceMetadata.Height, sourceMetadata.SizeBytes);
                session.Status = PaintSessionStatus.Active;
                session.Revision++;
                Touch(session);
            }
            return new CreatePaintSessionResult(sessionId, host.ChannelId);
        }
        catch
        {
            _sessions.TryRemove(sessionId, out _);
            ReleaseOpenSessionSlot(hostUserId);
            await ScheduleCleanupBestEffortAsync(sessionId);
            throw;
        }
    }

    public async Task<PaintParticipantChangeResult> JoinAsync(Guid sessionId, long userId, CancellationToken cancellationToken = default)
    {
        var session = GetSession(sessionId);
        if (!presence.TryGetParticipant(userId, out var current) || current.ChannelId != session.ChannelId) throw new PaintAuthorizationException("You must be in the paint channel.");
        lock (session.Lock)
        {
            RequireActive(session);
            if (IsCurrentParticipant(session, userId, out var existing))
                return new PaintParticipantChangeResult(existing, session.Revision, session.Generation);
        }
        long revision, generation;
        Task publish;
        PaintParticipant participant;
        lock (session.Lock)
        {
            RequireActive(session);
            if (!presence.TryGetParticipant(userId, out var confirmed)
                || confirmed.ChannelId != session.ChannelId
                || confirmed.MumbleSessionId != current.MumbleSessionId)
                throw new PaintAuthorizationException("Your voice connection changed; join paint again.");
            if (IsCurrentParticipant(session, userId, out var existing))
                return new PaintParticipantChangeResult(existing, session.Revision, session.Generation);
            if (session.Participants.Remove(userId))
            {
                ReleaseOpenSessionSlot(userId);
                session.Previews.Remove(userId);
            }
            ReserveOpenSessionSlot(userId);
            participant = new PaintParticipant(userId, confirmed.MumbleSessionId, confirmed.MatrixUserId);
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
            ReleaseOpenSessionSlot(userId);
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
            if (!rateLimiter.TryAcquireCommit(sessionId, userId, _utcNow())) throw new PaintConflictException("Stroke commit rate limit exceeded.");
            if (session.Strokes.Count >= MaxStrokesPerSession) throw new PaintConflictException("Paint session stroke limit reached.");
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
            RequireCurrentHost(session, userId); RequireActive(session); session.Generation++; session.Previews.Clear(); session.Strokes.Clear(); session.IdempotentCommits.Clear(); session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
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
            lock (session.Lock)
            {
                RequireCurrentHost(session, userId); RequireActive(session);
            }

            long revision, generation;
            Task publish;
            try
            {
                lock (session.Lock)
                {
                    RequireCurrentHost(session, userId); RequireActive(session); session.Status = PaintSessionStatus.Ended; session.TerminalAt = _utcNow(); ReleaseOpenSessionSlots(session); session.Revision++; Touch(session); revision = session.Revision; generation = session.Generation;
                    publish = EnqueuePermanentPublish(session, () => publisher.PublishToChannelAsync(session.ChannelId,
                        new { type = PaintEventNames.SessionEnded, sessionId, status = session.Status, revision, generation }));
                }
            }
            catch { throw; }
            try { await publish; }
            finally { await ScheduleCleanupBestEffortAsync(sessionId); }
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
            var canJoin = session.Status == PaintSessionStatus.Active;
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
            return new PaintSessionSnapshot(session.SessionId, session.ChannelId, session.HostUserId,
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
                long activityVersion;
                lock (session.Lock)
                {
                    if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired)
                    {
                        if (session.TerminalAt is not null && session.TerminalAt.Value + TerminalSessionRetention <= _utcNow())
                        {
                            _sessions.TryRemove(session.SessionId, out _);
                            rateLimiter.EvictSession(session.SessionId);
                        }
                        continue;
                    }
                    if (session.LastActivity + SessionTimeout > _utcNow()) continue;
                    activityVersion = session.ActivityVersion;
                }

                long revision, generation;
                var publish = Task.CompletedTask;
                var expiryCancelled = false;
                lock (session.Lock)
                {
                    if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired || session.ActivityVersion != activityVersion || session.LastActivity + SessionTimeout > _utcNow())
                        expiryCancelled = true;
                    else
                    {
                        session.Status = PaintSessionStatus.Expired; session.TerminalAt = _utcNow(); ReleaseOpenSessionSlots(session); session.Revision++; revision = session.Revision; generation = session.Generation;
                        publish = EnqueuePermanentPublish(session, () => publisher.PublishToChannelAsync(session.ChannelId,
                            new { type = PaintEventNames.SessionExpired, sessionId = session.SessionId, status = session.Status, revision, generation }));
                    }
                }
                if (expiryCancelled)
                {
                    continue;
                }
                try { await publish; }
                finally { await ScheduleCleanupBestEffortAsync(session.SessionId); }
            }
            finally
            {
                session.TerminalTransitionGate.Release();
            }
        }
    }

    public async Task<PaintSourceDownloadResult> ReadSourceAsync(Guid sessionId, long userId, CancellationToken cancellationToken = default)
    {
        var session = GetSession(sessionId);
        await session.TerminalTransitionGate.WaitAsync(cancellationToken);
        try
        {
            PaintSource source;
            lock (session.Lock)
            {
                RequireActive(session);
                _ = RequireCurrentParticipant(session, userId);
                source = session.Source ?? throw new PaintNotFoundException("Paint source was not found.");
            }

            var bytes = await sourceStore.ReadAsync(sessionId, cancellationToken);
            lock (session.Lock)
            {
                RequireActive(session);
                _ = RequireCurrentParticipant(session, userId);
            }
            return new PaintSourceDownloadResult(source, bytes);
        }
        finally
        {
            session.TerminalTransitionGate.Release();
        }
    }

    public bool ShouldRetainTemporaryData(Guid sessionId)
        => _sessions.TryGetValue(sessionId, out var session) && IsRetained(session);

    private static bool IsRetained(LivePaintSession session)
    {
        lock (session.Lock)
            return session.Status is PaintSessionStatus.PendingSource or PaintSessionStatus.Active;
    }

    private async Task ScheduleCleanupBestEffortAsync(Guid sessionId)
    {
        try
        {
            await cleanupRepository.RecordPendingAsync(sessionId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger?.LogWarning("Failed to schedule paint temporary cleanup: {SessionId} {FailureType}", sessionId, ex.GetType().Name);
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
                if (session.Status is PaintSessionStatus.Ended or PaintSessionStatus.Expired) continue;
                participant = session.Participants.Values.FirstOrDefault(candidate => candidate.MumbleSessionId == mumbleSessionId);
                if (participant is null) continue;

                session.Participants.Remove(participant.UserId);
                ReleaseOpenSessionSlot(participant.UserId);
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
    private void ReserveOpenSessionSlot(long userId)
    {
        lock (_openSessionCountsLock)
        {
            var count = _openSessionCounts.GetValueOrDefault(userId);
            if (count >= MaxOpenSessionsPerUser) throw new PaintConflictException("You have reached the open paint session limit.");
            _openSessionCounts[userId] = count + 1;
        }
    }

    private void ReleaseOpenSessionSlots(LivePaintSession session)
    {
        foreach (var userId in session.Participants.Keys)
            ReleaseOpenSessionSlot(userId);
    }

    private void ReleaseOpenSessionSlot(long userId)
    {
        lock (_openSessionCountsLock)
        {
            var count = _openSessionCounts.GetValueOrDefault(userId);
            if (count <= 1) _openSessionCounts.Remove(userId);
            else _openSessionCounts[userId] = count - 1;
        }
    }
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
    private static void RequireActive(LivePaintSession session) { if (session.Status != PaintSessionStatus.Active) throw new PaintConflictException("Paint session is not active."); }
    private void Touch(LivePaintSession session) { session.LastActivity = _utcNow(); session.ActivityVersion++; }
}
