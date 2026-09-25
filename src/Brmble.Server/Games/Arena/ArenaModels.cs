using Brmble.Server.Games.Continuous;

namespace Brmble.Server.Games.Arena;

public enum ArenaShrinkPhase { Hold, Normal, Collapse }
public enum ArenaKnockoutCause { OpponentProjectile, Recoil, DashOrMovement, Collapse }

/// <param name="RewindTicks">
/// How far into the opponent's past the hit test looks: the gap between the shooter's
/// prediction frame and the view frame they aimed in, fixed when the shot was fired.
/// Zero for a shot whose input carried no view tick.
/// </param>
public sealed record ArenaProjectile(
    long Id, long OwnerSessionId, int X, int Y, int Vx, int Vy, int ChargePermille, int RewindTicks = 0);

public sealed class ArenaPlayerState
{
    public required long SessionId { get; init; }
    public required int Side { get; init; }
    public int X;
    public int Y;
    public int Vx;
    public int Vy;
    public int AimX;
    public int AimY;
    public int ChargeTicks;
    public int ForcedFireTicks;
    public int CooldownTicks;
    public int DashTicks;
    public bool DashAvailable = true;
    public ContinuousInput Input = new(0, 0, 0, 0, 32767, 0, false, false, false);
    // Admission bookkeeping (see ArenaSimulation.Admit). Not part of the deterministic
    // hash: it decides what an input is allowed to ask for, not what the simulation does.
    public long AdmissionCooldownUntilTick;
    public bool DashReserved;
    public long DashReservationRound;
    // Position history for hit lag compensation, one entry per completed tick in a ring
    // keyed by tick modulo length; HistoryTick says which tick an entry belongs to, -1 for
    // none. Derived from the hashed state, so not hashed itself.
    internal readonly int[] HistoryX = new int[ArenaRulesetV1.HitHistoryTicks];
    internal readonly int[] HistoryY = new int[ArenaRulesetV1.HitHistoryTicks];
    internal readonly long[] HistoryTick = Enumerable.Repeat(-1L, ArenaRulesetV1.HitHistoryTicks).ToArray();
    internal ArenaKnockoutCause VelocityCause = ArenaKnockoutCause.DashOrMovement;
    internal ArenaKnockoutCause? BoundaryCause;
}

public sealed record ArenaSnapshotView(
    ContinuousMatchPhase Phase,
    long? PhaseEndsAtTick,
    IReadOnlyList<int> Score,
    int ConsecutiveDoubleKos,
    ArenaArenaView Arena,
    IReadOnlyList<ArenaPlayerView> Players,
    IReadOnlyList<ArenaProjectileView> Projectiles);

public sealed record ArenaArenaView(int Radius, ArenaShrinkPhase ShrinkPhase);

public sealed record ArenaPlayerView(
    long SessionId,
    int Side,
    int X,
    int Y,
    int Vx,
    int Vy,
    int AimX,
    int AimY,
    int ChargePermille,
    int? ForcedFireTicks,
    int CooldownTicks,
    bool DashAvailable,
    // Dash applications still owed after this tick. The client cannot infer this:
    // an input the server accepted but stripped acknowledges identically to one it
    // honoured, so a client reconstructing the window from its own sent inputs
    // predicts dashes that never happened. Authoritative here, guessed nowhere.
    int DashTicksRemaining,
    long? AcknowledgedInput);

public sealed record ArenaProjectileView(
    long Id,
    long OwnerSessionId,
    int X,
    int Y,
    int Vx,
    int Vy,
    int ChargePermille);

public sealed record ArenaMatchSummary(
    int SchemaVersion,
    IReadOnlyList<int> FinalScore,
    int RoundsPlayed,
    int DoubleKoReplays,
    IReadOnlyList<int> RoundDurations,
    IReadOnlyList<ArenaKnockoutCause> KoCauses,
    IReadOnlyList<int> Shots,
    IReadOnlyList<int> Hits,
    IReadOnlyList<IReadOnlyList<int>> FiredCharges,
    IReadOnlyList<IReadOnlyList<int>> LandedCharges,
    IReadOnlyList<int> DashUses,
    IReadOnlyList<int> KoRadii);

public sealed record ArenaParticipantStats(
    int Score,
    int Shots,
    int Hits,
    IReadOnlyList<int> FiredCharges,
    IReadOnlyList<int> LandedCharges,
    int DashUses);
