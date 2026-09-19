using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Continuous;

public sealed record InputResult(bool Accepted, ContinuousRejectReason Reason, long AcknowledgedInput);
public sealed record WelcomeMessage(
    int ProtocolVersion,
    int RulesetVersion,
    long MatchId,
    RealtimeRole Role,
    long SessionId,
    long SnapshotSequence,
    long ServerTick,
    // The server's wall clock at attach. The client seeds its clock-offset estimate
    // from this, so the interpolation buffer is measured in server time from the
    // first frame rather than from the first snapshot that happens to arrive.
    long GeneratedAtUnixMs,
    int TickRate,
    int SnapshotRate,
    int InterpolationMs,
    int MaxExtrapolationMs,
    int InputHeartbeatMs,
    int NeutralAfterMs,
    int ReconnectGraceMs,
    object Prediction,
    object State,
    long AcknowledgedInput);
public sealed record AttachResult(bool Ok, WelcomeMessage? Welcome, string? Error);

public sealed class ContinuousGameCoordinator : IDuelMatchRunner
{
    private const int MaxMessagesPerSecond = 120;
    // The client sends four a second; this only has to stop abuse.
    private const int MaxHeartbeatsPerSecond = 12;
    // Direction (the input's aim pair) changes per second. The client's aim throttle
    // intends 25 changes/second, heartbeats carry the direction as well, and fire and
    // dash bypass the throttle so their direction stays honest. Aggressive spam
    // measures around 33, so 30 sat below legitimate play. The client test 'stays
    // under the server aim-change budget' guards this relationship.
    private const int MaxDirectionChangesPerSecond = 45;
    // How far ahead of the simulation an input may be scheduled: half a second. A stamp
    // past this applies then rather than never; the client caps its own lead well below.
    internal const int MaxScheduleAheadTicks = 30;
    private static readonly TimeSpan RateWindow = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan AttachTimeout = TimeSpan.FromSeconds(15);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
    private readonly IReadOnlyDictionary<string, IContinuousGameDefinition> _definitions;
    private readonly TimeProvider _time;
    private readonly ICompletedMatchSink _sink;
    private readonly IGameEventPublisher _publisher;
    private readonly ILogger<ContinuousGameCoordinator> _logger;
    private readonly ConcurrentDictionary<long, ContinuousMatchState> _matches = new();
    private readonly ConcurrentDictionary<long, long> _matchByStableUser = new();
    private long _nextMatchId;

    public ContinuousGameCoordinator(
        IEnumerable<IContinuousGameDefinition> definitions,
        TimeProvider time,
        ICompletedMatchSink sink,
        IGameEventPublisher publisher,
        ILogger<ContinuousGameCoordinator> logger)
    {
        _definitions = definitions.ToDictionary(x => x.GameType, StringComparer.OrdinalIgnoreCase);
        _time = time;
        _sink = sink;
        _publisher = publisher;
        _logger = logger;
    }

    public string RunnerKey => "continuous";
    public event Func<MatchCompletion, Task>? MatchCompleted;
    internal event Action<string>? ParticipantDetached;

    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!string.Equals(reservation.Configuration.RunnerKey, RunnerKey, StringComparison.Ordinal))
            return new GameStartResult(false, 0, null,
                $"Runner '{reservation.Configuration.RunnerKey}' is not supported.");

        if (!_definitions.TryGetValue(reservation.Configuration.GameType, out var definition))
            return new GameStartResult(false, 0, null,
                $"Continuous game '{reservation.Configuration.GameType}' is unavailable.");
        if (reservation.PlayerOne.UserId == reservation.PlayerTwo.UserId
            || reservation.PlayerOne.SessionId == reservation.PlayerTwo.SessionId)
            return new GameStartResult(false, 0, null, "Continuous games require two distinct participants.");
        if (definition.ValidateConfiguration(reservation.Configuration) is { } configurationError)
            return new GameStartResult(false, 0, null, configurationError);

        var matchId = Interlocked.Increment(ref _nextMatchId);
        var startedAt = _time.GetUtcNow();
        var state = new ContinuousMatchState(reservation, definition, definition.Create(reservation), startedAt)
        {
            MatchId = matchId,
        };
        if (!_matchByStableUser.TryAdd(reservation.PlayerOne.UserId, matchId))
            return new GameStartResult(false, 0, null, "Player one already has an active game.");
        if (!_matchByStableUser.TryAdd(reservation.PlayerTwo.UserId, matchId))
        {
            RemoveIndex(_matchByStableUser, reservation.PlayerOne.UserId, matchId);
            return new GameStartResult(false, 0, null, "Player two already has an active game.");
        }
        if (!_matches.TryAdd(matchId, state))
        {
            RemoveIndex(_matchByStableUser, reservation.PlayerOne.UserId, matchId);
            RemoveIndex(_matchByStableUser, reservation.PlayerTwo.UserId, matchId);
            return new GameStartResult(false, 0, null, "The match could not be started.");
        }

        lock (state.SyncRoot)
        {
            var generation = ++state.AttachGeneration;
            state.AttachTimer = _time.CreateTimer(
                _ => AttachExpired(matchId, state, generation), null, AttachTimeout, Timeout.InfiniteTimeSpan);
        }
        try
        {
            await _publisher.PublishToUsersAsync(ParticipantUserIds(reservation), new
            {
                type = "game.started",
                matchId,
                gameType = reservation.Configuration.GameType,
                format = reservation.Configuration.Format,
                rulesetVersion = reservation.Configuration.RulesetVersion,
                options = reservation.Configuration.Options,
            });
        }
        catch
        {
            await CompleteAsync(matchId, state, null, "start_failed", reservation.PlayerOne.UserId);
            throw;
        }
        return new GameStartResult(true, matchId, startedAt, null);
    }

    public Task<AttachResult> AttachParticipantAsync(
        long matchId, long stableUserId, long sessionId, string connectionId, RealtimeSnapshotMailbox mailbox)
    {
        ArgumentException.ThrowIfNullOrEmpty(connectionId);
        ArgumentNullException.ThrowIfNull(mailbox);
        if (!_matches.TryGetValue(matchId, out var state))
            return Task.FromResult(new AttachResult(false, null, "wrongMatch"));

        WelcomeMessage welcome;
        string snapshot;
        lock (state.SyncRoot)
        {
            if (!state.Active || !state.ParticipantsByUser.TryGetValue(stableUserId, out var participant))
                return Task.FromResult(new AttachResult(false, null, "notParticipant"));
            if (state.Participants.TryGetValue(sessionId, out var sessionOwner)
                && !ReferenceEquals(sessionOwner, participant))
                return Task.FromResult(new AttachResult(false, null, "sessionInUse"));
            if (participant.Mailbox is not null && participant.ConnectionId != connectionId)
                return Task.FromResult(new AttachResult(false, null, "alreadyAttached"));
            if (participant.ConnectionId is not null)
                state.Connections.Remove(participant.ConnectionId);
            state.Participants.Remove(participant.SessionId);
            participant.SessionId = sessionId;
            participant.ConnectionId = connectionId;
            participant.Mailbox = mailbox;
            participant.AttachAcknowledged = false;
            participant.AttachSequence = checked(participant.NextSnapshotSequence++);
            state.Participants[sessionId] = participant;
            state.Connections[connectionId] = participant;

            var acknowledged = AcknowledgedInputs(state);
            var view = ParticipantView(state, participant, acknowledged);
            var attachedAt = _time.GetUtcNow();
            var timing = state.Definition.Timing;
            welcome = new WelcomeMessage(
                1, state.Reservation.Configuration.RulesetVersion, matchId, RealtimeRole.Participant,
                sessionId, participant.AttachSequence, state.Simulation.Tick,
                attachedAt.ToUnixTimeMilliseconds(),
                timing.TickRate, timing.SnapshotRate, timing.InterpolationMs, timing.MaxExtrapolationMs,
                timing.InputHeartbeatMs, timing.NeutralAfterMs, timing.ReconnectGraceMs,
                state.Definition.PredictionConstants, view, participant.AcknowledgedInput);
            snapshot = SerializeSnapshot(matchId, participant.AttachSequence, state.Simulation.Tick,
                attachedAt, view);
            mailbox.WriteControl(new RealtimeControl("welcome", sessionId, welcome.SnapshotSequence,
                SerializeWelcome(welcome), Coalescible: false));
            mailbox.ReplaceSnapshot(snapshot);
            return Task.FromResult(new AttachResult(true, welcome, null));
        }
    }

    public void AcknowledgeAttach(string connectionId, long snapshotSequence)
    {
        if (!TryFindConnection(connectionId, out var state, out var participant)) return;
        var startScheduler = false;
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.ConnectionId != connectionId
                || participant.AttachSequence != snapshotSequence)
                return;
            participant.AttachAcknowledged = true;
            participant.ConnectionGeneration++;
            participant.ReconnectTimer?.Dispose();
            participant.ReconnectTimer = null;
            if (state.Simulation.Phase == ContinuousMatchPhase.AwaitingParticipants
                && state.ParticipantsByUser.Values.All(x => x.AttachAcknowledged))
            {
                state.AttachTimer?.Dispose();
                state.AttachTimer = null;
                state.AttachGeneration++;
                foreach (var slot in state.ParticipantsByUser.Values)
                    state.Simulation.MarkParticipantReady(slot.SimulationSessionId);
                startScheduler = true;
            }
        }
        if (startScheduler) StartScheduler(state);
    }

    public Task DetachAsync(string connectionId)
    {
        if (!TryFindConnection(connectionId, out var state, out var participant))
            return Task.CompletedTask;
        RealtimeControl? control = null;
        List<RealtimeSnapshotMailbox> survivors = [];
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.ConnectionId != connectionId)
                return Task.CompletedTask;
            state.Connections.Remove(connectionId);
            participant.ConnectionId = null;
            participant.Mailbox = null;
            participant.AttachAcknowledged = false;
            participant.Scheduled.Clear();
            state.Simulation.SetNeutralInput(participant.SimulationSessionId);
            participant.NeutralTimer?.Dispose();
            participant.NeutralTimer = null;
            if (state.Simulation.Phase != ContinuousMatchPhase.AwaitingParticipants)
            {
                var generation = ++participant.ConnectionGeneration;
                participant.ReconnectTimer?.Dispose();
                participant.ReconnectTimer = _time.CreateTimer(
                    _ => ReconnectExpired(state, participant, generation), null,
                    state.ReconnectGrace, Timeout.InfiniteTimeSpan);
            }
            control = new RealtimeControl("connectionState", participant.SessionId, null,
                JsonSerializer.Serialize(new
                {
                    type = "connectionState", protocolVersion = 1, matchId = state.MatchId,
                    sessionId = participant.SessionId, state = "reconnecting",
                    graceEndsAtUnixMs = _time.GetUtcNow().Add(state.ReconnectGrace).ToUnixTimeMilliseconds(),
                }, JsonOptions), Coalescible: true);
            survivors = state.ParticipantsByUser.Values
                .Where(x => x.Mailbox is not null).Select(x => x.Mailbox!).ToList();
            foreach (var mailbox in survivors) mailbox.WriteControl(control);
        }
        ParticipantDetached?.Invoke(connectionId);
        return Task.CompletedTask;
    }

    public bool TryGetActiveMatch(long stableUserId, out ActiveMatchReference match)
    {
        if (_matchByStableUser.TryGetValue(stableUserId, out var matchId)
            && _matches.TryGetValue(matchId, out var state))
        {
            match = new ActiveMatchReference(
                matchId, state.Reservation.ReservationId, state.Reservation.ChannelId, RunnerKey);
            return true;
        }

        match = null!;
        return false;
    }

    public InputResult SubmitInput(
        long matchId, long sessionId, RealtimeRole role, ContinuousInput input, bool isHeartbeat)
    {
        if (!_matches.TryGetValue(matchId, out var state))
            return new InputResult(false, ContinuousRejectReason.WrongMatch, 0);

        lock (state.SyncRoot)
        {
            if (!state.Active
                || !_matches.TryGetValue(matchId, out var activeState)
                || !ReferenceEquals(state, activeState))
                return new InputResult(false, ContinuousRejectReason.WrongMatch, 0);
            if (!state.Participants.TryGetValue(sessionId, out var participant))
                return new InputResult(false, ContinuousRejectReason.WrongMatch, 0);
            if (role != RealtimeRole.Participant)
                return Reject(ContinuousRejectReason.WrongRole, participant);
            if (participant.ConnectionId is null || !participant.AttachAcknowledged)
                return Reject(ContinuousRejectReason.WrongMatch, participant);

            // Everything above is connection-level and stays a rejection: the client
            // treats those as fatal and that is the intent. Everything below is
            // acknowledged. Reject does not advance AcknowledgedInput, and a client whose
            // next frame is already in flight when the rejection lands answers the
            // resulting SequenceGap by reconnecting, which drops input capture and
            // silently clears the player's held movement keys. On any real network the
            // client's in-place rewind loses that race almost every time, so one refused
            // message became a dropped connection mid-fight. Game-level refusal is
            // therefore expressed only as a stripped or substituted field, never as a
            // rejected message.
            //
            // The single exception is a heartbeat carrying a fire or a dash. Heartbeats
            // carry held state and nothing else, so that is a malformed client, not
            // drift, and refusing it is the point.
            if (isHeartbeat && input.HasEdges())
                return Reject(ContinuousRejectReason.InvalidRange, participant);

            var now = _time.GetTimestamp();
            // Heartbeats are budgeted separately. They carry held state and nothing
            // else, so letting the input budget silence them is what turns a dropped
            // frame into a character that ignores the player until they let go of the
            // keys. The client sends four a second; this budget only has to stop abuse.
            var timestamps = isHeartbeat ? participant.HeartbeatTimestamps : participant.MessageTimestamps;
            var budget = isHeartbeat ? MaxHeartbeatsPerSecond : MaxMessagesPerSecond;
            RemoveExpired(timestamps, now);
            var messageRateExceeded = timestamps.Count >= budget;

            // The socket is ordered and reliable, so a stale or skipped sequence can only
            // be a retransmit or a client bug. Neither is a reason to drop the player:
            // a repeat is ignored and a gap is accepted by advancing to what arrived.
            // Both are logged because after this change they should never happen.
            var acknowledgedInput = participant.AcknowledgedInput;
            if (input.Sequence <= acknowledgedInput)
            {
                _logger.LogInformation(
                    "Realtime input for match {MatchId}, session {SessionId} repeated sequence {Sequence} at or below acknowledged {AcknowledgedInput}; ignored.",
                    matchId, sessionId, input.Sequence, acknowledgedInput);
                return new InputResult(true, default, acknowledgedInput);
            }
            if (input.Sequence != acknowledgedInput + 1)
            {
                _logger.LogInformation(
                    "Realtime input for match {MatchId}, session {SessionId} skipped {Gap} sequences before {Sequence}; accepted.",
                    matchId, sessionId, input.Sequence - acknowledgedInput - 1, input.Sequence);
            }

            // The heartbeat budget - twelve a second against the four the client sends -
            // is only ever reached by abuse, so an over-budget heartbeat is acknowledged
            // and otherwise ignored: it neither lands nor refreshes the neutral deadline.
            // The input budget is different, normal play reaches it, so an over-budget
            // input still applies its held state further down.
            if (messageRateExceeded && isHeartbeat)
            {
                participant.AcknowledgedInput = input.Sequence;
                return new InputResult(true, default, input.Sequence);
            }

            // Out-of-range fields are corrected rather than refused. The tick is clamped
            // into [tick + 1, tick + 30]: a late stamp applies on the next step, a
            // far-future one no more than half a second out. The realistic way a stamp
            // leaves the window is the server falling behind wall time - FixedStepScheduler
            // forgives its catch-up debt after MaxCatchUpTicks - so a stall of half a
            // second used to put every subsequent input past the window until the next
            // snapshot, exactly when a reconnect storm was least affordable. The clamp is
            // logged because it is the health signal for the client's lead estimate.
            var sanitized = Sanitize(input, state.Simulation.Tick, participant);
            if (sanitized.PredictedTick != input.PredictedTick)
            {
                _logger.LogDebug(
                    "Realtime input for match {MatchId}, session {SessionId} stamped tick {PredictedTick} against server tick {ServerTick}; clamped by {Distance} ticks.",
                    matchId, sessionId, input.PredictedTick, state.Simulation.Tick,
                    sanitized.PredictedTick - input.PredictedTick);
            }
            input = sanitized;

            var directionChanged = !input.SameDirection(participant.DirectionX, participant.DirectionY);
            var directionRateExceeded = false;
            if (directionChanged)
            {
                RemoveExpired(participant.DirectionChangeTimestamps, now);
                directionRateExceeded = participant.DirectionChangeTimestamps.Count >= MaxDirectionChangesPerSecond;
            }

            // Over the message budget the held state still lands and only the edges are
            // discarded, for the same reason the aim-rate clamp below keeps movement:
            // rate limiting is about message volume, and a character that freezes reads
            // as a broken game rather than as a rate limit. The message is not counted
            // against the window, exactly as a rejected one never was, so a flood cannot
            // extend its own punishment; it is simply cheap and nearly inert.
            if (messageRateExceeded)
                input = input.HeldOnly();

            // A direction-rate violation clamps the direction to the last accepted one
            // and lets the rest of the input through. Movement, charging and dash merely
            // shared a message with the offending direction; discarding them makes the
            // character stop responding to the player, which reads as a broken game
            // rather than as a rate limit. Volume is still capped by the message budget
            // above, and a direction that is refused here simply does not move.
            if (directionRateExceeded)
            {
                input = input with { AimX = participant.DirectionX, AimY = participant.DirectionY };
                directionChanged = false;
            }

            if (!messageRateExceeded)
                timestamps.Enqueue(now);
            if (directionChanged)
                participant.DirectionChangeTimestamps.Enqueue(now);
            participant.DirectionX = input.AimX;
            participant.DirectionY = input.AimY;

            // Acknowledgement means received, and it must stay that way: the client
            // measures its round trip from it, and an acknowledgement that waited for
            // the install would fold the client's own lead into that estimate.
            participant.AcknowledgedInput = input.Sequence;

            // The stamp names the tick the input applies at. The client runs ahead of the
            // server by its measured round trip plus a margin and predicts from the same
            // tick, so installing here at the stamp - rather than on arrival - is what
            // makes the two agree. An input due for the very next step is installed now;
            // that is the same order the scheduler would install it in, and it keeps a
            // "now" input visible to the simulation the moment it is accepted.
            Schedule(participant, input);
            InstallDue(state, participant);

            participant.AcceptedGeneration = checked(participant.AcceptedGeneration + 1);
            participant.NeutralTimer?.Dispose();
            var timerResolution = TimeSpan.FromTicks(Math.Max(
                1L,
                (long)Math.Ceiling((double)TimeSpan.TicksPerSecond / _time.TimestampFrequency)));
            var neutralDelay = state.NeutralTimeout + timerResolution;
            var acceptedGeneration = participant.AcceptedGeneration;
            participant.NeutralTimer = _time.CreateTimer(
                _ => NeutralizeIfStale(state, participant, acceptedGeneration),
                null,
                neutralDelay,
                Timeout.InfiniteTimeSpan);
            return new InputResult(true, default, input.Sequence);
        }
    }

    /// <summary>
    /// Installs every scheduled input that is due for the next step. What the scheduler
    /// runs before each <c>Step()</c>; exposed so tests can drive it against a
    /// simulation whose tick they advance by hand.
    /// </summary>
    internal void InstallScheduledInputs(long matchId)
    {
        if (!_matches.TryGetValue(matchId, out var state)) return;
        lock (state.SyncRoot)
        {
            if (!state.Active) return;
            foreach (var participant in state.ParticipantsByUser.Values)
                InstallDue(state, participant);
        }
    }

    private static void Schedule(ParticipantInputState participant, ContinuousInput input)
    {
        // Ordered by stamp, then by arrival. Stamps are monotonic on a sane client and the
        // socket is ordered, so this is an append in practice; the walk back covers a
        // clamp that pulled a far-future stamp below an earlier one.
        var scheduled = participant.Scheduled;
        var index = scheduled.Count;
        while (index > 0 && scheduled[index - 1].PredictedTick > input.PredictedTick) index--;
        scheduled.Insert(index, input);
    }

    private static void InstallDue(ContinuousMatchState state, ParticipantInputState participant)
    {
        var scheduled = participant.Scheduled;
        while (scheduled.Count > 0 && scheduled[0].PredictedTick <= state.Simulation.Tick + 1)
        {
            var input = scheduled[0];
            scheduled.RemoveAt(0);
            Install(state, participant, input);
        }
    }

    /// <summary>
    /// Installation. Admission is the game's: <see cref="IContinuousSimulation.Admit"/>
    /// runs here, at install time, against the state the input will actually meet -
    /// which for a scheduled input is not the state it was received against.
    /// </summary>
    private static void Install(ContinuousMatchState state, ParticipantInputState participant, ContinuousInput input)
    {
        var admitted = state.Simulation.Admit(participant.SimulationSessionId, input);
        state.Simulation.SetInput(participant.SimulationSessionId, admitted);
    }

    public async Task ForfeitAsync(long matchId, long stableUserId, string reason)
    {
        if (!_matchByStableUser.TryGetValue(stableUserId, out var ownedMatchId)
            || ownedMatchId != matchId
            || !_matches.TryGetValue(matchId, out var state))
            return;
        await CompleteAsync(matchId, state, null, reason, stableUserId);
    }

    private async Task CompleteAsync(
        long matchId, ContinuousMatchState state, ContinuousCompletion? outcome,
        string? abandonReason, long? forfeitingUserId)
    {
        List<ParticipantInputState> participants;
        ITimer? attachTimer;
        List<ITimer> participantTimers;
        Task? schedulerTask;
        long? winnerSessionId;
        var endedAt = _time.GetUtcNow();
        lock (state.SyncRoot)
        {
            if (!state.Active || !((ICollection<KeyValuePair<long, ContinuousMatchState>>)_matches)
                    .Remove(new(matchId, state)))
                return;
            state.Active = false;
            state.Cancellation.Cancel();
            attachTimer = state.AttachTimer;
            state.AttachTimer = null;
            schedulerTask = state.SchedulerTask;
            state.SchedulerTask = null;
            participants = state.ParticipantsByUser.Values.ToList();
            // Resolved under the lock because it reads ParticipantInputState.SessionId,
            // which reattaches mutate.
            winnerSessionId = ResolveWinnerSessionId(state, outcome, abandonReason, forfeitingUserId);
            participantTimers = participants.SelectMany(participant =>
                new[] { participant.NeutralTimer, participant.ReconnectTimer }.OfType<ITimer>()).ToList();
            foreach (var participant in participants)
            {
                participant.NeutralTimer = null;
                participant.ReconnectTimer = null;
            }
        }

        attachTimer?.Dispose();
        foreach (var timer in participantTimers) timer.Dispose();
        if (schedulerTask is not null)
            ObserveSchedulerTermination(state, schedulerTask);
        else
            state.Cancellation.Dispose();

        var acknowledged = AcknowledgedInputs(state);
        foreach (var participant in participants)
        {
            participant.Scheduled.Clear();
            try { state.Simulation.SetNeutralInput(participant.SimulationSessionId); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to neutralize participant during continuous match {MatchId} cleanup.", matchId);
            }
            if (participant.Mailbox is null) continue;
            try
            {
                var finalView = ParticipantView(state, participant, acknowledged);
                var sequence = participant.NextSnapshotSequence++;
                var json = JsonSerializer.Serialize(new
                {
                    type = "matchClosed", protocolVersion = 1, matchId, sequence,
                    serverTick = state.Simulation.Tick,
                    reason = abandonReason is null ? "completed" : "forfeited",
                    finalState = finalView,
                }, JsonOptions);
                if (!participant.Mailbox.SealTerminal(new RealtimeControl(
                        "matchClosed", null, sequence, json, Coalescible: false)))
                    _logger.LogWarning("Terminal mailbox was overloaded for continuous match {MatchId}.", matchId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to build terminal state for continuous match {MatchId}.", matchId);
            }
        }

        var completedParticipants = outcome is null
            ? ForfeitParticipants(state.Reservation, forfeitingUserId!.Value)
            : BuildCompletedParticipants(outcome);
        string? metadataJson = null;
        try { metadataJson = JsonSerializer.Serialize(outcome?.MatchSummary ?? new { schemaVersion = 1 }, JsonOptions); }
        catch (Exception ex) { _logger.LogError(ex, "Failed to serialize continuous match {MatchId} metadata.", matchId); }
        var completed = new CompletedMatch(
            state.Reservation.Configuration.GameType, state.Reservation.ChannelId,
            state.Reservation.Configuration.Format, state.Reservation.Configuration.RulesetVersion,
            outcome?.Outcome ?? "abandoned", abandonReason, state.StartedAt, endedAt,
            completedParticipants, metadataJson);
        try { _sink.Enqueue(completed); }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Failed to enqueue completed continuous match {MatchId}.", matchId);
        }
        RemoveIndex(_matchByStableUser, state.Reservation.PlayerOne.UserId, matchId);
        RemoveIndex(_matchByStableUser, state.Reservation.PlayerTwo.UserId, matchId);
        var completion = new MatchCompletion(matchId, state.Reservation.ReservationId,
            state.Reservation.ChannelId, state.Reservation.PlayerOne, state.Reservation.PlayerTwo,
            state.Reservation.Configuration, endedAt);
        var handlers = MatchCompleted;
        if (handlers is not null)
        {
            foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
            {
                try { await handler(completion); }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "Match completion subscriber failed for continuous match {MatchId} (reservation {ReservationId}).",
                        completion.MatchId, completion.ReservationId);
                }
            }
        }
        try
        {
            await _publisher.PublishToUsersAsync(ParticipantUserIds(state.Reservation), new
            {
                type = "game.ended", matchId,
                gameType = state.Reservation.Configuration.GameType,
                format = state.Reservation.Configuration.Format,
                rulesetVersion = state.Reservation.Configuration.RulesetVersion,
                options = state.Reservation.Configuration.Options,
                abandoned = abandonReason is not null, reason = abandonReason,
                winnerId = winnerSessionId,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to publish game.ended for continuous match {MatchId}.", matchId);
        }
    }

    private IReadOnlyList<CompletedParticipant> BuildCompletedParticipants(ContinuousCompletion outcome) =>
        outcome.Participants.Select(participant =>
        {
            try
            {
                return participant with
                {
                    MetadataJson = outcome.ParticipantStats.TryGetValue(participant.UserId, out var stats)
                        ? JsonSerializer.Serialize(stats, JsonOptions)
                        : participant.MetadataJson,
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to serialize continuous participant {UserId} metadata.", participant.UserId);
                return participant;
            }
        }).ToArray();

    private void ObserveSchedulerTermination(ContinuousMatchState state, Task schedulerTask)
    {
        _ = schedulerTask.ContinueWith(task =>
        {
            if (task.IsFaulted)
                _logger.LogError(task.Exception, "Continuous scheduler terminated unexpectedly for match {MatchId}.", state.MatchId);
            state.Cancellation.Dispose();
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    /// <summary>
    /// Resolves the winner for the <c>game.ended</c> bridge event as a Mumble SESSION id,
    /// matching what <see cref="GameSessionManager"/> publishes for the other game types and
    /// what the arena wire uses for player identity. Returns <c>null</c> when there is no
    /// single winner (a draw), so callers never invent one.
    /// </summary>
    /// <remarks>
    /// Both cases resolve a stable user id first and then translate it, because the two
    /// sources disagree: the reservation is keyed by user id, and
    /// <see cref="ContinuousCompletion.Participants"/> carry stable user ids too
    /// (<c>CompletedParticipant.UserId</c> is genuinely a user id here, unlike the
    /// misnamed <c>GamePlayer.UserId</c> elsewhere). Only the final translation step
    /// produces a session id.
    /// </remarks>
    private static long? ResolveWinnerSessionId(
        ContinuousMatchState state, ContinuousCompletion? outcome,
        string? abandonReason, long? forfeitingUserId)
    {
        long winnerUserId;
        if (outcome is null)
        {
            // start_failed (:128) and scheduler_error (:659) blame PlayerOne purely by
            // convention for a server fault neither player caused. Naming a winner here
            // would make the client vanish PlayerOne as the loser, so the wire must stay
            // silent. The persisted record keeps its existing (invisible) convention.
            // connection_timeout and realtime_disconnect are excluded deliberately: those
            // do blame the participant who actually dropped.
            if (abandonReason is "start_failed" or "scheduler_error") return null;

            // Forfeit / abandon: the winner is the participant who did not forfeit.
            // Mirrors ForfeitParticipants so the wire and the persisted record agree.
            winnerUserId = state.Reservation.PlayerOne.UserId == forfeitingUserId
                ? state.Reservation.PlayerTwo.UserId
                : state.Reservation.PlayerOne.UserId;
        }
        else
        {
            var winner = outcome.Participants.FirstOrDefault(x =>
                string.Equals(x.Result, "win", StringComparison.Ordinal));
            if (winner is null) return null;
            winnerUserId = winner.UserId;
        }

        return state.ParticipantsByUser.TryGetValue(winnerUserId, out var participant)
            ? participant.SessionId
            : null;
    }

    private static IReadOnlyList<CompletedParticipant> ForfeitParticipants(
        DuelReservation reservation, long forfeitingUserId)
    {
        var winner = reservation.PlayerOne.UserId == forfeitingUserId
            ? reservation.PlayerTwo.UserId : reservation.PlayerOne.UserId;
        return
        [
            new CompletedParticipant(winner, 1, null, "win"),
            new CompletedParticipant(forfeitingUserId, 2, null, "abandoned"),
        ];
    }

    private void AttachExpired(long matchId, ContinuousMatchState state, long generation)
    {
        long? missingUser = null;
        lock (state.SyncRoot)
        {
            if (state.Active && state.AttachGeneration == generation
                && state.Simulation.Phase == ContinuousMatchPhase.AwaitingParticipants)
                missingUser = state.ParticipantsByUser.Values.FirstOrDefault(x => !x.AttachAcknowledged)?.StableUserId;
        }
        if (missingUser is not null)
            ObserveBackground(CompleteAsync(matchId, state, null, "connection_timeout", missingUser.Value),
                matchId, "attach timeout completion");
    }

    private void ReconnectExpired(
        ContinuousMatchState state, ParticipantInputState participant, long generation)
    {
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.ConnectionGeneration != generation
                || participant.AttachAcknowledged)
                return;
        }
        ObserveBackground(CompleteAsync(state.MatchId, state, null, "realtime_disconnect", participant.StableUserId),
            state.MatchId, "reconnect timeout completion");
    }

    private void ObserveBackground(Task task, long matchId, string operation)
    {
        _ = task.ContinueWith(faulted =>
            _logger.LogError(faulted.Exception, "Continuous match {MatchId} {Operation} failed.", matchId, operation),
            CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void StartScheduler(ContinuousMatchState state)
    {
        lock (state.SyncRoot)
        {
            if (!state.Active || state.SchedulerTask is not null) return;
            state.SchedulerTask = Task.Run(() => RunSchedulerAsync(state));
        }
    }

    private async Task RunSchedulerAsync(ContinuousMatchState state)
    {
        var timing = state.Definition.Timing;
        var scheduler = new FixedStepScheduler(_time, timing.TickRate, timing.MaxCatchUpTicks);
        scheduler.Start(_time.GetTimestamp());
        try
        {
            while (!state.Cancellation.IsCancellationRequested)
            {
                var plan = scheduler.PlanCycle();
                for (var index = 0; index < plan.Ticks; index++)
                {
                    ContinuousCompletion? completion = null;
                    lock (state.SyncRoot)
                    {
                        if (!state.Active) return;
                        foreach (var participant in state.ParticipantsByUser.Values)
                            InstallDue(state, participant);
                        var result = state.Simulation.Step();
                        if (result.Completed) completion = result.Completion;
                        if (state.Simulation.Tick % timing.SnapshotEveryTicks == 0)
                        {
                            var acknowledged = AcknowledgedInputs(state);
                            foreach (var participant in state.ParticipantsByUser.Values.Where(
                                         x => x.Mailbox is not null && x.AttachAcknowledged))
                            {
                                var view = ParticipantView(state, participant, acknowledged);
                                participant.Mailbox!.ReplaceSnapshot(SerializeSnapshot(state.MatchId,
                                    participant.NextSnapshotSequence++, state.Simulation.Tick, _time.GetUtcNow(), view));
                            }
                        }
                    }
                    if (completion is not null)
                    {
                        await CompleteAsync(state.MatchId, state, completion, completion.AbandonReason, null);
                        return;
                    }
                }
                var delay = _time.GetElapsedTime(_time.GetTimestamp(), plan.NextDeadline);
                if (delay > TimeSpan.Zero)
                    await Task.Delay(delay, _time, state.Cancellation.Token);
                else
                    await Task.Yield();
            }
        }
        catch (OperationCanceledException) when (state.Cancellation.IsCancellationRequested) { }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Continuous scheduler failed for match {MatchId}.", state.MatchId);
            await CompleteAsync(state.MatchId, state, null, "scheduler_error",
                state.Reservation.PlayerOne.UserId);
        }
    }

    private bool TryFindConnection(
        string connectionId, out ContinuousMatchState state, out ParticipantInputState participant)
    {
        foreach (var candidate in _matches.Values)
        {
            lock (candidate.SyncRoot)
            {
                if (candidate.Connections.TryGetValue(connectionId, out participant!))
                {
                    state = candidate;
                    return true;
                }
            }
        }
        state = null!;
        participant = null!;
        return false;
    }

    private static Dictionary<long, long> AcknowledgedInputs(ContinuousMatchState state) =>
        state.ParticipantsByUser.Values.ToDictionary(x => x.SimulationSessionId, x => x.AcknowledgedInput);

    private static object ParticipantView(
        ContinuousMatchState state,
        ParticipantInputState participant,
        IReadOnlyDictionary<long, long> acknowledgedInputs)
    {
        // A reconnected participant has a new wire session id while the simulation
        // keeps the one it started with. The game substitutes wherever its snapshot
        // names a session; the coordinator only knows the mapping.
        var wireSessionIds = state.ParticipantsByUser.Values
            .ToDictionary(x => x.SimulationSessionId, x => x.SessionId);
        return state.Simulation.ParticipantSnapshot(participant.SimulationSessionId, acknowledgedInputs, wireSessionIds);
    }

    private static HashSet<long> ParticipantUserIds(DuelReservation reservation) =>
        [reservation.PlayerOne.UserId, reservation.PlayerTwo.UserId];

    private static string SerializeSnapshot(
        long matchId, long sequence, long serverTick, DateTimeOffset generatedAt, object view)
    {
        var viewJson = JsonSerializer.SerializeToElement(view, JsonOptions);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "snapshot");
            writer.WriteNumber("protocolVersion", 1);
            writer.WriteNumber("matchId", matchId);
            writer.WriteNumber("sequence", sequence);
            writer.WriteNumber("serverTick", serverTick);
            writer.WriteNumber("generatedAtUnixMs", generatedAt.ToUnixTimeMilliseconds());
            foreach (var property in viewJson.EnumerateObject()) property.WriteTo(writer);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string SerializeWelcome(WelcomeMessage welcome)
    {
        var welcomeJson = JsonSerializer.SerializeToElement(welcome, JsonOptions);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "welcome");
            foreach (var property in welcomeJson.EnumerateObject()) property.WriteTo(writer);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    internal static void RemoveIndex(
        ConcurrentDictionary<long, long> index, long stableUserId, long matchId) =>
        ((ICollection<KeyValuePair<long, long>>)index).Remove(new(stableUserId, matchId));

    private static InputResult Reject(ContinuousRejectReason reason, ParticipantInputState participant) =>
        new(false, reason, participant.AcknowledgedInput);

    private void RemoveExpired(Queue<long> timestamps, long now)
    {
        while (timestamps.TryPeek(out var timestamp)
               && _time.GetElapsedTime(timestamp, now) >= RateWindow)
            timestamps.Dequeue();
    }

    /// <summary>
    /// Corrects an input's out-of-range fields instead of refusing the message. The
    /// tick is clamped into the window the scheduler will install it in; a movement vector longer
    /// than unit is scaled down along its own direction; an aim that is zero or longer
    /// than unit is replaced by the last accepted aim, which is what the aim-rate clamp
    /// already substitutes. <c>short.MinValue</c> is the one component value the
    /// original range check refused outright (it has no positive counterpart), so it
    /// is folded to <c>-32_767</c> before scaling.
    /// </summary>
    internal static ContinuousInput Sanitize(
        ContinuousInput input, long serverTick, short lastAimX, short lastAimY)
    {
        var predictedTick = Math.Clamp(input.PredictedTick, serverTick + 1, serverTick + MaxScheduleAheadTicks);

        var move = FixedVec.NormalizeQ15(
            Math.Max(input.MoveX, (short)-32_767), Math.Max(input.MoveY, (short)-32_767));

        var aimX = Math.Max(input.AimX, (short)-32_767);
        var aimY = Math.Max(input.AimY, (short)-32_767);
        var aimSquared = (long)aimX * aimX + (long)aimY * aimY;
        if (aimSquared == 0 || FixedVec.IntegerSqrt(aimSquared) > 32_767)
        {
            aimX = lastAimX;
            aimY = lastAimY;
        }

        return input with
        {
            PredictedTick = predictedTick,
            MoveX = checked((short)move.X),
            MoveY = checked((short)move.Y),
            AimX = aimX,
            AimY = aimY,
        };
    }

    private static ContinuousInput Sanitize(
        ContinuousInput input, long serverTick, ParticipantInputState participant) =>
        Sanitize(input, serverTick, participant.DirectionX, participant.DirectionY);

    private void NeutralizeIfStale(
        ContinuousMatchState state, ParticipantInputState participant, long acceptedGeneration)
    {
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.AcceptedGeneration != acceptedGeneration)
                return;

            participant.Scheduled.Clear();
            state.Simulation.SetNeutralInput(participant.SimulationSessionId);
            participant.NeutralTimer?.Dispose();
            participant.NeutralTimer = null;
        }
    }

    private sealed class ContinuousMatchState
    {
        public ContinuousMatchState(
            DuelReservation reservation,
            IContinuousGameDefinition definition,
            IContinuousSimulation simulation,
            DateTimeOffset startedAt)
        {
            Reservation = reservation;
            Definition = definition;
            Simulation = simulation;
            StartedAt = startedAt;
            Participants = CreateParticipants(reservation, simulation);
            ParticipantsByUser = Participants.Values.ToDictionary(x => x.StableUserId);
        }

        public DuelReservation Reservation { get; }
        public IContinuousGameDefinition Definition { get; }
        public IContinuousSimulation Simulation { get; }
        public TimeSpan NeutralTimeout => TimeSpan.FromMilliseconds(Definition.Timing.NeutralAfterMs);
        public TimeSpan ReconnectGrace => TimeSpan.FromMilliseconds(Definition.Timing.ReconnectGraceMs);
        public DateTimeOffset StartedAt { get; }
        public object SyncRoot { get; } = new();
        public bool Active { get; set; } = true;
        public long MatchId { get; set; }
        public long AttachGeneration;
        public ITimer? AttachTimer;
        public CancellationTokenSource Cancellation { get; } = new();
        public Task? SchedulerTask;
        public Dictionary<long, ParticipantInputState> Participants { get; }
        public Dictionary<long, ParticipantInputState> ParticipantsByUser { get; }
        public Dictionary<string, ParticipantInputState> Connections { get; } = [];

        private static Dictionary<long, ParticipantInputState> CreateParticipants(
            DuelReservation reservation, IContinuousSimulation simulation)
        {
            var byUser = new[] { reservation.PlayerOne, reservation.PlayerTwo }
                .ToDictionary(x => x.UserId, x => new ParticipantInputState(x.UserId, x.SessionId));
            var participants = byUser.Values.ToDictionary(x => x.SessionId);
            foreach (var participant in participants.Values)
            {
                // The direction-change budget compares against the last accepted
                // direction; seeding it from the game's initial input means the first
                // frame is compared against the true starting direction.
                var initial = simulation.InitialInput(participant.SimulationSessionId);
                participant.DirectionX = initial.AimX;
                participant.DirectionY = initial.AimY;
            }

            return participants;
        }
    }

    private sealed class ParticipantInputState(long stableUserId, long sessionId)
    {
        public long StableUserId { get; } = stableUserId;
        public long SimulationSessionId { get; } = sessionId;
        public long SessionId = sessionId;
        public string? ConnectionId;
        public RealtimeSnapshotMailbox? Mailbox;
        public bool AttachAcknowledged;
        public long AttachSequence;
        public long NextSnapshotSequence = 1;
        public long ConnectionGeneration;
        public ITimer? ReconnectTimer;
        public long AcknowledgedInput;
        /// <summary>Received inputs not yet due, ordered by stamp then arrival.</summary>
        public List<ContinuousInput> Scheduled { get; } = [];
        public short DirectionX = 32_767;
        public short DirectionY;
        public long AcceptedGeneration;
        public Queue<long> MessageTimestamps { get; } = [];
        public Queue<long> HeartbeatTimestamps { get; } = [];
        public Queue<long> DirectionChangeTimestamps { get; } = [];
        public ITimer? NeutralTimer;
    }
}
