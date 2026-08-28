using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Continuous;

public enum RealtimeRole { Participant, Spectator }
public enum ContinuousMatchPhase { AwaitingParticipants, Loading, Positioning, Live, Ended }
public enum ContinuousRejectReason { StaleSequence, SequenceGap, InvalidRange, RateLimited, WrongMatch, WrongRole, PhaseDenied, Cooldown, DashSpent }

public sealed record ContinuousInput(
    long Sequence, long PredictedTick, short MoveX, short MoveY,
    short AimX, short AimY, bool Charging, bool FireReleased, bool Dash);
public sealed record ProcessedInput(long SessionId, long Sequence, long PredictedTick, long ReceivedTimestamp);
public sealed record ContinuousStepResult(bool Completed, ContinuousCompletion? Completion);
public sealed record ContinuousCompletion(
    string Outcome, string? AbandonReason, IReadOnlyList<CompletedParticipant> Participants,
    object MatchSummary, IReadOnlyDictionary<long, object> ParticipantStats);

public interface IContinuousSimulation
{
    long Tick { get; }
    ContinuousMatchPhase Phase { get; }
    void SetInput(long sessionId, ContinuousInput input);
    void SetNeutralInput(long sessionId);
    ContinuousStepResult Step();
    object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs);
    object SpectatorSnapshot();
    ulong DeterministicHash();
}

public interface IContinuousGameDefinition
{
    string GameType { get; }
    int RulesetVersion { get; }
    IContinuousSimulation Create(DuelReservation reservation);
    object PredictionConstants { get; }
}
