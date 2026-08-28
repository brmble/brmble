using System.Collections.Concurrent;
using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Continuous;

public sealed record InputResult(bool Accepted, ContinuousRejectReason Reason, long AcknowledgedInput);

public sealed class ContinuousGameCoordinator : IDuelMatchRunner
{
    private const int MaxMessagesPerSecond = 120;
    private const int MaxAimChangesPerSecond = 30;
    private static readonly TimeSpan RateWindow = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan NeutralTimeout = TimeSpan.FromMilliseconds(750);
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

    public Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!string.Equals(reservation.Configuration.RunnerKey, RunnerKey, StringComparison.Ordinal))
            return Task.FromResult(new GameStartResult(false, 0, null,
                $"Runner '{reservation.Configuration.RunnerKey}' is not supported."));

        if (!_definitions.TryGetValue(reservation.Configuration.GameType, out var definition))
            return Task.FromResult(new GameStartResult(false, 0, null,
                $"Continuous game '{reservation.Configuration.GameType}' is unavailable."));

        var matchId = Interlocked.Increment(ref _nextMatchId);
        var startedAt = _time.GetUtcNow();
        var state = new ContinuousMatchState(reservation, definition.Create(reservation), startedAt);
        if (!_matchByStableUser.TryAdd(reservation.PlayerOne.UserId, matchId))
            return Task.FromResult(new GameStartResult(false, 0, null,
                "Player one already has an active game."));
        if (!_matchByStableUser.TryAdd(reservation.PlayerTwo.UserId, matchId))
        {
            RemoveIndex(_matchByStableUser, reservation.PlayerOne.UserId, matchId);
            return Task.FromResult(new GameStartResult(false, 0, null,
                "Player two already has an active game."));
        }
        if (!_matches.TryAdd(matchId, state))
        {
            RemoveIndex(_matchByStableUser, reservation.PlayerOne.UserId, matchId);
            RemoveIndex(_matchByStableUser, reservation.PlayerTwo.UserId, matchId);
            return Task.FromResult(new GameStartResult(false, 0, null,
                "The match could not be started."));
        }

        // Scheduler, realtime sockets, and the participant attach gate are added by later tasks.
        return Task.FromResult(new GameStartResult(true, matchId, startedAt, null));
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

            if (state.Simulation.Phase == ContinuousMatchPhase.Live
                && participant.LastObservedPhase != ContinuousMatchPhase.Live)
                participant.DashSpent = false;
            participant.LastObservedPhase = state.Simulation.Phase;

            var arenaPlayer = state.Simulation is ArenaSimulation arena
                ? arena.Players.First(player => player.SessionId == sessionId)
                : null;
            if (participant.DashSpent
                && arenaPlayer is { DashAvailable: true, DashTicks: 0 }
                && state.Simulation.Tick > participant.DashSpentTick)
                participant.DashSpent = false;

            var aimChanged = input.AimX != participant.AimX || input.AimY != participant.AimY;
            var aimRateExceeded = false;
            if (aimChanged)
            {
                RemoveExpired(participant.AimChangeTimestamps, now);
                aimRateExceeded = participant.AimChangeTimestamps.Count >= MaxAimChangesPerSecond;
            }

            if (state.Simulation.Phase != ContinuousMatchPhase.Live)
            {
                if (input.Charging || input.FireReleased || input.Dash)
                    return Reject(ContinuousRejectReason.PhaseDenied, participant);
            }
            else if ((input.Charging || input.FireReleased)
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
            if (IsNeutral(input))
                state.Simulation.SetNeutralInput(sessionId);
            else
                state.Simulation.SetInput(sessionId, input);

            participant.AimX = input.AimX;
            participant.AimY = input.AimY;
            participant.AcknowledgedInput = input.Sequence;
            if (input.FireReleased)
                participant.CooldownUntilTick = checked(state.Simulation.Tick + ArenaRulesetV1.ShotCooldownTicks);
            if (input.Dash)
            {
                participant.DashSpent = true;
                participant.DashSpentTick = state.Simulation.Tick;
            }
            participant.LastAcceptedTimestamp = now;
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
            || !_matches.TryRemove(matchId, out var state))
            return;

        RemoveIndex(_matchByStableUser, state.Reservation.PlayerOne.UserId, matchId);
        RemoveIndex(_matchByStableUser, state.Reservation.PlayerTwo.UserId, matchId);

        lock (state.SyncRoot)
        {
            state.Active = false;
            foreach (var participant in state.Participants.Values)
            {
                participant.NeutralTimer?.Dispose();
                state.Simulation.SetNeutralInput(participant.SessionId);
            }
        }

        // Persistence, publishing, and completion metadata are added by later tasks.
        _ = reason;
        _ = _sink;
        _ = _publisher;
        _ = _logger;
        var completion = new MatchCompletion(
            matchId,
            state.Reservation.ReservationId,
            state.Reservation.ChannelId,
            state.Reservation.PlayerOne,
            state.Reservation.PlayerTwo,
            state.Reservation.Configuration,
            _time.GetUtcNow());
        var handlers = MatchCompleted;
        if (handlers is null)
            return;

        foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
        {
            try
            {
                await handler(completion);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Match completion subscriber failed for continuous match {MatchId} (reservation {ReservationId}).",
                    completion.MatchId, completion.ReservationId);
            }
        }
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

        const long maxLengthSquared = 32_767L * 32_767L;
        var movementSquared = (long)input.MoveX * input.MoveX + (long)input.MoveY * input.MoveY;
        var aimSquared = (long)input.AimX * input.AimX + (long)input.AimY * input.AimY;
        return input.MoveX >= -32_767
               && input.MoveY >= -32_767
               && input.AimX >= -32_767
               && input.AimY >= -32_767
               && movementSquared <= maxLengthSquared
               && aimSquared > 0
               && aimSquared <= maxLengthSquared;
    }

    private static bool IsNeutral(ContinuousInput input) =>
        input.MoveX == 0
        && input.MoveY == 0
        && !input.Charging
        && !input.FireReleased
        && !input.Dash;

    private void NeutralizeIfStale(
        ContinuousMatchState state, ParticipantInputState participant, long acceptedGeneration)
    {
        lock (state.SyncRoot)
        {
            if (!state.Active || participant.AcceptedGeneration != acceptedGeneration)
                return;

            state.Simulation.SetNeutralInput(participant.SessionId);
            participant.NeutralTimer?.Dispose();
            participant.NeutralTimer = null;
        }
    }

    private sealed class ContinuousMatchState(
        DuelReservation reservation,
        IContinuousSimulation simulation,
        DateTimeOffset startedAt)
    {
        public DuelReservation Reservation { get; } = reservation;
        public IContinuousSimulation Simulation { get; } = simulation;
        public DateTimeOffset StartedAt { get; } = startedAt;
        public object SyncRoot { get; } = new();
        public bool Active { get; set; } = true;
        public Dictionary<long, ParticipantInputState> Participants { get; } = CreateParticipants(reservation, simulation);

        private static Dictionary<long, ParticipantInputState> CreateParticipants(
            DuelReservation reservation, IContinuousSimulation simulation)
        {
            var participants = new Dictionary<long, ParticipantInputState>
            {
                [reservation.PlayerOne.SessionId] = new(reservation.PlayerOne.SessionId),
                [reservation.PlayerTwo.SessionId] = new(reservation.PlayerTwo.SessionId),
            };
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

    private sealed class ParticipantInputState(long sessionId)
    {
        public long SessionId { get; } = sessionId;
        public long AcknowledgedInput;
        public short AimX = 32_767;
        public short AimY;
        public long CooldownUntilTick;
        public bool DashSpent;
        public long DashSpentTick;
        public ContinuousMatchPhase LastObservedPhase = ContinuousMatchPhase.AwaitingParticipants;
        public long LastAcceptedTimestamp;
        public long AcceptedGeneration;
        public Queue<long> MessageTimestamps { get; } = [];
        public Queue<long> AimChangeTimestamps { get; } = [];
        public ITimer? NeutralTimer;
    }
}
