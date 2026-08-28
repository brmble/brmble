using System.Text.Json.Serialization;

namespace Brmble.Server.Games.Arena;

public static class ArenaRulesetV1
{
    public const int Version = 1;
    public const int UnitsPerWorldUnit = 1_000;
    public const int TickRate = 60;
    public const int SnapshotRate = 20;
    public const int SnapshotEveryTicks = 3;
    public const int MaxCatchUpTicks = 5;
    public const int LoadingTicks = 60;
    public const int PositioningTicks = 180;
    public const int InitialArenaRadius = 9_000;
    public const int CombatArenaRadius = 3_500;
    public const int SpawnOffset = 3_500;
    public const int PlayerRadius = 600;
    public const int BaseMovePerTick = 90;
    public const int ChargedMovePerTick = 45;
    public const int MomentumRetentionPermille = 920;
    public const int ChargeTicks = 90;
    public const int ForcedFireTicks = 30;
    public const int ShotCooldownTicks = 24;
    public const int ProjectileRadius = 180;
    public const int ProjectilePerTick = 240;
    public const int ProjectileBaseKnockback = 130;
    public const int ProjectileBonusKnockback = 220;
    public const int RecoilBase = 45;
    public const int RecoilBonus = 105;
    public const int DashTicks = 6;
    public const int DashPerTick = 240;
    public const int OpeningHoldTicks = 600;
    public const int NormalShrinkTicks = 1_800;
    public const int CollapseTicks = 1_200;
    public const int MaxConsecutiveDoubleKos = 3;
    public const int TargetRoundWins = 2;
    public const int AimQuantizationMax = 32_767;

    public static int MovePerTick(int q) =>
        checked((int)(90L - 45L * Math.Clamp(q, 0, 1000) / 1000L));
    public static int Knockback(int q) =>
        checked((int)(130L + 220L * Math.Clamp(q, 0, 1000) / 1000L));
    public static int Recoil(int q) =>
        checked((int)(45L + 105L * Math.Clamp(q, 0, 1000) / 1000L));
    public static int ChargePermille(int chargeTicks) =>
        checked((int)Math.Min(1000L, Math.Clamp(chargeTicks, 0, 90) * 1000L / 90L));

    public static int ArenaRadius(int liveTick) => liveTick switch
    {
        < 600 => 9_000,
        < 2_400 => checked((int)(9_000L - 5_500L * (liveTick - 599) / 1_800L)),
        < 3_600 => checked((int)(3_500L - 3_500L * (liveTick - 2_399) / 1_200L)),
        _ => 0,
    };

    public static object PredictionConstants { get; } = new ArenaPredictionConstants(
        UnitsPerWorldUnit,
        PlayerRadius,
        BaseMovePerTick,
        ChargedMovePerTick,
        MomentumRetentionPermille,
        ChargeTicks,
        ForcedFireTicks,
        ShotCooldownTicks,
        ProjectileRadius,
        ProjectilePerTick,
        ProjectileBaseKnockback,
        ProjectileBonusKnockback,
        RecoilBase,
        RecoilBonus,
        DashTicks,
        DashPerTick);
}

public sealed record ArenaPredictionConstants(
    [property: JsonPropertyName("unitsPerWorldUnit")] int UnitsPerWorldUnit,
    [property: JsonPropertyName("playerRadius")] int PlayerRadius,
    [property: JsonPropertyName("baseMovePerTick")] int BaseMovePerTick,
    [property: JsonPropertyName("chargedMovePerTick")] int ChargedMovePerTick,
    [property: JsonPropertyName("momentumRetentionPermille")] int MomentumRetentionPermille,
    [property: JsonPropertyName("chargeTicks")] int ChargeTicks,
    [property: JsonPropertyName("forcedFireTicks")] int ForcedFireTicks,
    [property: JsonPropertyName("shotCooldownTicks")] int ShotCooldownTicks,
    [property: JsonPropertyName("projectileRadius")] int ProjectileRadius,
    [property: JsonPropertyName("projectilePerTick")] int ProjectilePerTick,
    [property: JsonPropertyName("projectileBaseKnockback")] int ProjectileBaseKnockback,
    [property: JsonPropertyName("projectileBonusKnockback")] int ProjectileBonusKnockback,
    [property: JsonPropertyName("recoilBase")] int RecoilBase,
    [property: JsonPropertyName("recoilBonus")] int RecoilBonus,
    [property: JsonPropertyName("dashTicks")] int DashTicks,
    [property: JsonPropertyName("dashPerTick")] int DashPerTick);
