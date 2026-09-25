using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Continuous;

public enum RealtimeRole { Participant, Spectator }
public enum ContinuousMatchPhase { AwaitingParticipants, Loading, Positioning, Live, Ended }

/// <summary>
/// Why the coordinator refused a message. Only connection-level reasons remain in
/// use: everything game-level is expressed by stripping or substituting fields and
/// acknowledging the message, never by rejecting it.
/// </summary>
public enum ContinuousRejectReason { StaleSequence, SequenceGap, InvalidRange, RateLimited, WrongMatch, WrongRole }

/// <summary>
/// The continuous wire input. The shape is fixed - two axes (move, aim), one held
/// button (charging) and two edges (fire, dash) - and is shared by every continuous
/// game. The coordinator touches it only through <see cref="ContinuousInputs"/>: the
/// held part, the edges, and the direction pair the aim-rate budget watches. A game
/// that needs a different shape is the moment to revisit this, with two concrete
/// games in hand rather than one and a guess.
/// </summary>
public sealed record ContinuousInput(
    long Sequence, long PredictedTick, short MoveX, short MoveY,
    short AimX, short AimY, bool Charging, bool FireReleased, bool Dash,
    /// <summary>
    /// The tick the client's view of the other players was showing when this input was
    /// made: the sampled snapshot timeline sits a downlink plus the interpolation buffer
    /// behind the stamp. A game that judges an aimed action in the shooter's frame
    /// (arena hits) rewinds the target by <c>PredictedTick - ViewTick</c>. Zero means
    /// unknown - an older client, a heartbeat, a held frame - and no compensation. The
    /// coordinator bounds the gap and keeps it across a stamp clamp.
    /// </summary>
    long ViewTick = 0);

public static class ContinuousInputs
{
    public static readonly ContinuousInput Neutral = new(0, 0, 0, 0, 32_767, 0, false, false, false);

    /// <summary>The one-shot actions. A heartbeat never carries them.</summary>
    public static bool HasEdges(this ContinuousInput input) => input.FireReleased || input.Dash;

    /// <summary>The input with its edges cleared: what a heartbeat carries.</summary>
    public static ContinuousInput HeldOnly(this ContinuousInput input) =>
        input with { FireReleased = false, Dash = false, ViewTick = 0 };

    /// <summary>The direction pair the direction-change budget watches.</summary>
    public static bool SameDirection(this ContinuousInput input, short x, short y) =>
        input.AimX == x && input.AimY == y;
}

public sealed record ProcessedInput(long SessionId, long Sequence, long PredictedTick, long ReceivedTimestamp);
public sealed record ContinuousStepResult(bool Completed, ContinuousCompletion? Completion);
public sealed record ContinuousCompletion(
    string Outcome, string? AbandonReason, IReadOnlyList<CompletedParticipant> Participants,
    object MatchSummary, IReadOnlyDictionary<long, object> ParticipantStats);

/// <summary>
/// The timing a continuous game runs at. The coordinator paces the simulation,
/// snapshots, budgets and timeouts from this and nothing else.
/// </summary>
/// <param name="TickRate">Simulation steps per second.</param>
/// <param name="SnapshotEveryTicks">A snapshot is broadcast every this many steps.</param>
/// <param name="MaxCatchUpTicks">Steps the scheduler runs in one cycle before forgiving its debt.</param>
/// <param name="InterpolationMs">The client's remote-player interpolation delay.</param>
/// <param name="MaxExtrapolationMs">How far past the newest snapshot the client may extrapolate.</param>
/// <param name="InputHeartbeatMs">How often the client re-sends held state.</param>
/// <param name="NeutralAfterMs">Held state is neutralised when nothing arrives for this long.</param>
/// <param name="ReconnectGraceMs">A detached participant has this long to reattach.</param>
public sealed record ContinuousTiming(
    int TickRate,
    int SnapshotEveryTicks,
    int MaxCatchUpTicks,
    int InterpolationMs,
    int MaxExtrapolationMs,
    int InputHeartbeatMs,
    int NeutralAfterMs,
    int ReconnectGraceMs)
{
    /// <summary>60 Hz, snapshot every 3 ticks, and the tuning the arena shipped with.</summary>
    public static ContinuousTiming Default { get; } = new(60, 3, 5, 100, 50, 250, 750, 5_000);

    public int SnapshotRate => TickRate / SnapshotEveryTicks;
}

public interface IContinuousSimulation
{
    long Tick { get; }
    ContinuousMatchPhase Phase { get; }

    /// <summary>
    /// Called once per participant when their attach is acknowledged. A game that
    /// waits for both players before starting begins from here.
    /// </summary>
    void MarkParticipantReady(long sessionId) { }

    /// <summary>
    /// The input a participant starts with. The coordinator seeds its direction-change
    /// budget from it so the first frame is compared against the true initial aim.
    /// </summary>
    ContinuousInput InitialInput(long sessionId) => ContinuousInputs.Neutral;

    /// <summary>
    /// Game-level admission. Returns the input as the game will accept it - fields
    /// stripped or substituted, never rejected - evaluated against the state the input
    /// will meet, which is why it runs at install time. Deliberately has no default: a
    /// new game must decide what it refuses before it compiles.
    /// </summary>
    ContinuousInput Admit(long sessionId, ContinuousInput input);

    void SetInput(long sessionId, ContinuousInput input);
    void SetNeutralInput(long sessionId);
    ContinuousStepResult Step();

    /// <summary>A participant's view, keyed by the simulation's session ids.</summary>
    object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs);

    /// <summary>
    /// A participant's view with wire session ids substituted. A participant who
    /// reconnects gets a new session id while the simulation keeps the one it started
    /// with; the map goes simulation id to current wire id. The default is for a
    /// snapshot that carries no session identity - a game whose snapshot names
    /// players must override it.
    /// </summary>
    object ParticipantSnapshot(
        long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs,
        IReadOnlyDictionary<long, long> wireSessionIds) => ParticipantSnapshot(sessionId, acknowledgedInputs);

    object SpectatorSnapshot();
    ulong DeterministicHash();
}

public interface IContinuousGameDefinition
{
    string GameType { get; }
    int RulesetVersion { get; }
    ContinuousTiming Timing => ContinuousTiming.Default;
    object PredictionConstants { get; }

    /// <summary>
    /// Refuses a reservation whose configuration this game cannot run, with the
    /// reason as the start error. Null accepts it.
    /// </summary>
    string? ValidateConfiguration(DuelConfiguration configuration) => null;

    IContinuousSimulation Create(DuelReservation reservation);
}
