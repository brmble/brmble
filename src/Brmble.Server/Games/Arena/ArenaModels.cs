using Brmble.Server.Games.Continuous;

namespace Brmble.Server.Games.Arena;

public enum ArenaShrinkPhase { Hold, Normal, Collapse }
public enum ArenaKnockoutCause { OpponentProjectile, Recoil, DashOrMovement, Collapse }

public sealed record ArenaProjectile(
    long Id, long OwnerSessionId, int X, int Y, int Vx, int Vy, int ChargePermille);

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
