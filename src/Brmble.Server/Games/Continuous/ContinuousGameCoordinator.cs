using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Server.Games.Arena;
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
    private const int MaxAimChangesPerSecond = 30;
    private static readonly TimeSpan RateWindow = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan NeutralTimeout = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan AttachTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan ReconnectGrace = TimeSpan.FromSeconds(5);
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
        if (string.Equals(reservation.Configuration.GameType, "arena-knockoff", StringComparison.OrdinalIgnoreCase)
            && (reservation.Configuration.GameType != "arena-knockoff"
                || reservation.Configuration.Format != "bo3"
                || reservation.Configuration.RulesetVersion != ArenaRulesetV1.Version
                || reservation.Configuration.Options.Count != 0))
            return new GameStartResult(false, 0, null, "Arena configuration is not canonical.");

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
            welcome = new WelcomeMessage(
                1, state.Reservation.Configuration.RulesetVersion, matchId, RealtimeRole.Participant,
                sessionId, participant.AttachSequence, state.Simulation.Tick,
                ArenaRulesetV1.TickRate, ArenaRulesetV1.SnapshotRate, 100, 50, 250, 750, 5000,
                state.Definition.PredictionConstants, view, participant.AcknowledgedInput);
            snapshot = SerializeSnapshot(matchId, participant.AttachSequence, state.Simulation.Tick,
                _time.GetUtcNow(), view);
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
                if (state.Simulation is ArenaSimulation arena)
                    foreach (var slot in state.ParticipantsByUser.Values)
                        arena.MarkParticipantReady(slot.SimulationSessionId);
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
            state.Simulation.SetNeutralInput(participant.SimulationSessionId);
            participant.NeutralTimer?.Dispose();
            participant.NeutralTimer = null;
            if (state.Simulation.Phase != ContinuousMatchPhase.AwaitingParticipants)
            {
                var generation = ++participant.ConnectionGeneration;
                participant.ReconnectTimer?.Dispose();
                participant.ReconnectTimer = _time.CreateTimer(
                    _ => ReconnectExpired(state, participant, generation), null,
                    ReconnectGrace, Timeout.InfiniteTimeSpan);
            }
            control = new RealtimeControl("connectionState", participant.SessionId, null,
                JsonSerializer.Serialize(new
                {
                    type = "connectionState", protocolVersion = 1, matchId = state.MatchId,
                    sessionId = participant.SessionId, state = "reconnecting",
                    graceEndsAtUnixMs = _time.GetUtcNow().Add(ReconnectGrace).ToUnixTimeMilliseconds(),
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

            var now = _time.GetTimestamp();
            RemoveExpired(participant.MessageTimestamps, now);
            var messageRateExceeded = participant.MessageTimestamps.Count >= MaxMessagesPerSecond;

            var acknowledgedInput = participant.AcknowledgedInput;
            if (input.Sequence <= acknowledgedInput)
                return Reject(ContinuousRejectReason.StaleSequence, participant);
            if (input.Sequence != acknowledgedInput + 1)
                return Reject(ContinuousRejectReason.SequenceGap, participant);
            if (!IsInRange(input, state.Simulation.Tick, isHeartbeat))
                return Reject(ContinuousRejectReason.InvalidRange, participant);

            var arenaPlayer = state.Simulation is ArenaSimulation arena
                ? arena.Players.First(player => player.SessionId == participant.SimulationSessionId)
                : null;
            if (state.Simulation is ArenaSimulation arenaSimulation
                && participant.RoundGeneration != arenaSimulation.RoundGeneration)
            {
                participant.DashSpent = false;
                participant.RoundGeneration = arenaSimulation.RoundGeneration;
            }

            var aimChanged = input.AimX != participant.AimX || input.AimY != participant.AimY;
            var aimRateExceeded = false;
            if (aimChanged)
            {
                RemoveExpired(participant.AimChangeTimestamps, now);
                aimRateExceeded = participant.AimChangeTimestamps.Count >= MaxAimChangesPerSecond;
            }

            if (state.Simulation.Phase != ContinuousMatchPhase.Live)
            {
                if (input.FireReleased || input.Dash)
                    return Reject(ContinuousRejectReason.PhaseDenied, participant);
            }
            else if (input.FireReleased
                     && (state.Simulation.Tick < participant.CooldownUntilTick
                         || arenaPlayer is { CooldownTicks: > 0 }))
            {
                return Reject(ContinuousRejectReason.Cooldown, participant);
            }
            else if (input.Dash && participant.DashSpent)
            {
                return Reject(ContinuousRejectReason.DashSpent, participant);
            }
            if (messageRateExceeded || aimRateExceeded)
                return Reject(ContinuousRejectReason.RateLimited, participant);

            participant.MessageTimestamps.Enqueue(now);
            if (aimChanged)
                participant.AimChangeTimestamps.Enqueue(now);
            state.Simulation.SetInput(participant.SimulationSessionId, input);

            participant.AimX = input.AimX;
            participant.AimY = input.AimY;
            participant.AcknowledgedInput = input.Sequence;
            if (input.FireReleased)
                participant.CooldownUntilTick = checked(state.Simulation.Tick + ArenaRulesetV1.ShotCooldownTicks);
            if (input.Dash)
                participant.DashSpent = true;
            participant.AcceptedGeneration = checked(participant.AcceptedGeneration + 1);
            participant.NeutralTimer?.Dispose();
            var timerResolution = TimeSpan.FromTicks(Math.Max(
                1L,
                (long)Math.Ceiling((double)TimeSpan.TicksPerSecond / _time.TimestampFrequency)));
            var neutralDelay = NeutralTimeout + timerResolution;
            var acceptedGeneration = participant.AcceptedGeneration;
            participant.NeutralTimer = _time.CreateTimer(
                _ => NeutralizeIfStale(state, participant, acceptedGeneration),
                null,
                neutralDelay,
                Timeout.InfiniteTimeSpan);
            return new InputResult(true, default, input.Sequence);
        }
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
                gameType = "arena-knockoff", format = "bo3", rulesetVersion = 1,
                options = state.Reservation.Configuration.Options,
                abandoned = abandonReason is not null, reason = abandonReason,
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
        var scheduler = new FixedStepScheduler(_time, ArenaRulesetV1.TickRate, ArenaRulesetV1.MaxCatchUpTicks);
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
                        var result = state.Simulation.Step();
                        if (result.Completed) completion = result.Completion;
                        if (state.Simulation.Tick % ArenaRulesetV1.SnapshotEveryTicks == 0)
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
        var view = state.Simulation.ParticipantSnapshot(participant.SimulationSessionId, acknowledgedInputs);
        if (view is not ArenaSnapshotView arena) return view;

        var currentBySimulation = state.ParticipantsByUser.Values
            .ToDictionary(x => x.SimulationSessionId, x => x.SessionId);
        return arena with
        {
            Players = Array.AsReadOnly(arena.Players.Select(player => player with
            {
                SessionId = currentBySimulation[player.SessionId],
            }).ToArray()),
            Projectiles = Array.AsReadOnly(arena.Projectiles.Select(projectile => projectile with
            {
                OwnerSessionId = currentBySimulation[projectile.OwnerSessionId],
            }).ToArray()),
        };
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

    private static bool IsInRange(ContinuousInput input, long serverTick, bool isHeartbeat)
    {
        if (input.PredictedTick < serverTick - 120 || input.PredictedTick > serverTick + 30)
            return false;
        if (isHeartbeat && (input.FireReleased || input.Dash))
            return false;

        var movementSquared = (long)input.MoveX * input.MoveX + (long)input.MoveY * input.MoveY;
        var aimSquared = (long)input.AimX * input.AimX + (long)input.AimY * input.AimY;
        return input.MoveX >= -32_767
               && input.MoveY >= -32_767
               && input.AimX >= -32_767
               && input.AimY >= -32_767
               && FixedVec.IntegerSqrt(movementSquared) <= 32_767
               && aimSquared > 0
               && FixedVec.IntegerSqrt(aimSquared) <= 32_767;
    }

    private void NeutralizeIfStale(
        ContinuousMatchState state, ParticipantInputState participant, long acceptedGeneration)
    {
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.AcceptedGeneration != acceptedGeneration)
                return;

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
            if (simulation is ArenaSimulation arena)
            {
                foreach (var player in arena.Players)
                {
                    participants[player.SessionId].AimX = checked((short)player.AimX);
                    participants[player.SessionId].AimY = checked((short)player.AimY);
                }
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
        public short AimX = 32_767;
        public short AimY;
        public long CooldownUntilTick;
        public bool DashSpent;
        public long RoundGeneration;
        public long AcceptedGeneration;
        public Queue<long> MessageTimestamps { get; } = [];
        public Queue<long> AimChangeTimestamps { get; } = [];
        public ITimer? NeutralTimer;
    }
}
