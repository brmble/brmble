using System.Buffers.Binary;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Arena;

public sealed class ArenaSimulation : IContinuousSimulation
{
    private static readonly ContinuousInput NeutralInput =
        new(0, 0, 0, 0, 32767, 0, false, false, false);

    private readonly HashSet<long> _readySessionIds = [];
    private readonly int[] _score = [0, 0];
    private readonly List<ArenaProjectile> _projectiles = [];
    private int _phaseTick;
    private int _liveTick;

    public ArenaSimulation(DuelReservation reservation)
    {
        var sessionIds = new[]
        {
            reservation.PlayerOne.SessionId,
            reservation.PlayerTwo.SessionId,
        };
        Array.Sort(sessionIds);
        if (sessionIds[0] == sessionIds[1])
            throw new ArgumentException("Arena requires two distinct participant sessions.", nameof(reservation));

        Players =
        [
            CreatePlayer(sessionIds[0], side: 0, x: -ArenaRulesetV1.SpawnOffset),
            CreatePlayer(sessionIds[1], side: 1, x: ArenaRulesetV1.SpawnOffset),
        ];
    }

    public long Tick { get; private set; }
    public ContinuousMatchPhase Phase { get; private set; } = ContinuousMatchPhase.AwaitingParticipants;
    public ArenaPlayerState[] Players { get; }
    public IReadOnlyList<int> Score => _score;
    public IReadOnlyList<ArenaProjectile> Projectiles => _projectiles;
    public int ArenaRadius { get; private set; } = ArenaRulesetV1.InitialArenaRadius;
    public ArenaShrinkPhase ShrinkPhase => _liveTick switch
    {
        < ArenaRulesetV1.OpeningHoldTicks => ArenaShrinkPhase.Hold,
        < ArenaRulesetV1.OpeningHoldTicks + ArenaRulesetV1.NormalShrinkTicks => ArenaShrinkPhase.Normal,
        _ => ArenaShrinkPhase.Collapse,
    };

    public void MarkParticipantReady(long sessionId)
    {
        if (!Players.Any(player => player.SessionId == sessionId))
            return;

        _readySessionIds.Add(sessionId);
        if (Phase == ContinuousMatchPhase.AwaitingParticipants && _readySessionIds.Count == Players.Length)
        {
            Phase = ContinuousMatchPhase.Loading;
            _phaseTick = 0;
        }
    }

    public void SetInput(long sessionId, ContinuousInput input) => FindPlayer(sessionId).Input = input;

    public void SetNeutralInput(long sessionId) => FindPlayer(sessionId).Input = NeutralInput;

    public ContinuousStepResult Step()
    {
        if (Phase == ContinuousMatchPhase.AwaitingParticipants || Phase == ContinuousMatchPhase.Ended)
            return new ContinuousStepResult(false, null);

        // These calls deliberately lock the authoritative stage order. Task 6 fills only the named stubs.
        DecrementTimers();                         // 1
        InstallInputAndUpdateCharge();             // 2
        ProcessDashEdges();                        // 3
        ProcessFire();                             // 4
        ApplyMovement();                           // 5
        ApplyDashMovement();                       // 6
        IntegrateVelocity();                       // 7
        DampVelocity();                            // 8
        ResolveBodyOverlap();                      // 9
        AdvanceProjectilesAndResolveHits();        // 10
        RemoveExpiredProjectiles();                // 11
        UpdateShrink();                            // 12
        EvaluatePlayerBoundaries();                // 13
        ResolveRound();                            // 14
        FinishTickAndPhase();                      // 15

        return new ContinuousStepResult(false, null);
    }

    public bool IsInsideArena(int x, int y)
    {
        var distanceSquared = checked((long)x * x + (long)y * y);
        var radiusSquared = checked((long)ArenaRadius * ArenaRadius);
        return distanceSquared <= radiusSquared;
    }

    public object ParticipantSnapshot(
        long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs) =>
        CreateSnapshot(acknowledgedInputs);

    public object SpectatorSnapshot() => CreateSnapshot(null);

    public ulong DeterministicHash()
    {
        var bytes = new byte[sizeof(long) + 13 * sizeof(int)];
        BinaryPrimitives.WriteInt64LittleEndian(bytes, Tick);
        var offset = sizeof(long);
        Write((int)Phase);
        Write(_liveTick);
        Write(ArenaRadius);
        foreach (var player in Players)
        {
            Write(player.X);
            Write(player.Y);
            Write(player.Vx);
            Write(player.Vy);
            Write(player.ChargeTicks);
        }

        return FixedVec.Fnv1a64(bytes);

        void Write(int value)
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offset), value);
            offset += sizeof(int);
        }
    }

    private static ArenaPlayerState CreatePlayer(long sessionId, int side, int x) => new()
    {
        SessionId = sessionId,
        Side = side,
        X = x,
        AimX = side == 0 ? ArenaRulesetV1.AimQuantizationMax : -ArenaRulesetV1.AimQuantizationMax,
    };

    private ArenaPlayerState FindPlayer(long sessionId) =>
        Players.First(player => player.SessionId == sessionId);

    private void DecrementTimers()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        foreach (var player in Players)
        {
            if (player.CooldownTicks > 0)
                player.CooldownTicks--;
            if (player.ForcedFireTicks > 0)
                player.ForcedFireTicks--;
        }
    }

    private void InstallInputAndUpdateCharge()
    {
        if (Phase == ContinuousMatchPhase.Loading)
            return;

        foreach (var player in Players)
        {
            var movement = FixedVec.NormalizeQ15(player.Input.MoveX, player.Input.MoveY);
            var aim = FixedVec.NormalizeQ15(player.Input.AimX, player.Input.AimY);
            player.Input = player.Input with
            {
                MoveX = checked((short)movement.X),
                MoveY = checked((short)movement.Y),
                AimX = checked((short)aim.X),
                AimY = checked((short)aim.Y),
            };
            player.AimX = aim.X;
            player.AimY = aim.Y;

            if (Phase == ContinuousMatchPhase.Live && player.Input.Charging && player.CooldownTicks == 0)
            {
                if (player.ChargeTicks < ArenaRulesetV1.ChargeTicks)
                {
                    player.ChargeTicks++;
                    if (player.ChargeTicks == ArenaRulesetV1.ChargeTicks)
                        player.ForcedFireTicks = ArenaRulesetV1.ForcedFireTicks;
                }
            }
            else
            {
                player.ChargeTicks = 0;
                player.ForcedFireTicks = 0;
            }
        }
    }

    private void ProcessDashEdges()
    {
        // Task 6.
    }

    private void ProcessFire()
    {
        // Task 6.
    }

    private void ApplyMovement()
    {
        if (Phase == ContinuousMatchPhase.Loading)
            return;

        foreach (var player in Players)
        {
            var chargePermille = ArenaRulesetV1.ChargePermille(player.ChargeTicks);
            var displacement = new FixedVec(player.Input.MoveX, player.Input.MoveY)
                .Scale(ArenaRulesetV1.MovePerTick(chargePermille));
            player.X = checked(player.X + displacement.X);
            player.Y = checked(player.Y + displacement.Y);
        }
    }

    private void ApplyDashMovement()
    {
        // Task 6.
    }

    private void IntegrateVelocity()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        foreach (var player in Players)
        {
            player.X = checked(player.X + player.Vx);
            player.Y = checked(player.Y + player.Vy);
        }
    }

    private void DampVelocity()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        foreach (var player in Players)
        {
            player.Vx = checked((int)(player.Vx * (long)ArenaRulesetV1.MomentumRetentionPermille / 1000L));
            player.Vy = checked((int)(player.Vy * (long)ArenaRulesetV1.MomentumRetentionPermille / 1000L));
        }
    }

    private void ResolveBodyOverlap()
    {
        if (Phase == ContinuousMatchPhase.Loading)
            return;

        var low = Players[0];
        var high = Players[1];
        var dx = checked(high.X - (long)low.X);
        var dy = checked(high.Y - (long)low.Y);
        var distanceSquared = checked(dx * dx + dy * dy);
        var diameter = checked(ArenaRulesetV1.PlayerRadius * 2);
        if (distanceSquared >= checked((long)diameter * diameter))
            return;

        var distance = FixedVec.IntegerSqrt(distanceSquared);
        var normal = distance == 0
            ? new FixedVec(ArenaRulesetV1.AimQuantizationMax, 0)
            : new FixedVec(
                checked((int)(dx * ArenaRulesetV1.AimQuantizationMax / distance)),
                checked((int)(dy * ArenaRulesetV1.AimQuantizationMax / distance)));
        var penetration = diameter - distance;
        var lowShare = penetration / 2;
        var highShare = penetration - lowShare;

        low.X = checked(low.X - (int)(normal.X * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
        low.Y = checked(low.Y - (int)(normal.Y * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
        high.X = checked(high.X + (int)(normal.X * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
        high.Y = checked(high.Y + (int)(normal.Y * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
    }

    private void AdvanceProjectilesAndResolveHits()
    {
        // Task 6.
    }

    private void RemoveExpiredProjectiles()
    {
        // Task 6.
    }

    private void UpdateShrink()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        _liveTick = checked(_liveTick + 1);
        ArenaRadius = ArenaRulesetV1.ArenaRadius(_liveTick);
    }

    private void EvaluatePlayerBoundaries()
    {
        // Task 7 resolves boundary results after all Task 5 and Task 6 displacement stages.
    }

    private void ResolveRound()
    {
        // Task 7.
    }

    private void FinishTickAndPhase()
    {
        Tick = checked(Tick + 1);
        _phaseTick = checked(_phaseTick + 1);

        if (Phase == ContinuousMatchPhase.Loading && _phaseTick == ArenaRulesetV1.LoadingTicks)
        {
            Phase = ContinuousMatchPhase.Positioning;
            _phaseTick = 0;
        }
        else if (Phase == ContinuousMatchPhase.Positioning
                 && _phaseTick == ArenaRulesetV1.PositioningTicks)
        {
            Phase = ContinuousMatchPhase.Live;
            _phaseTick = 0;
        }
    }

    private ArenaSnapshotView CreateSnapshot(IReadOnlyDictionary<long, long>? acknowledgedInputs) => new(
        Tick,
        Phase,
        Array.AsReadOnly((int[])_score.Clone()),
        new ArenaArenaView(ArenaRadius, ShrinkPhase),
        Players.Select(player => new ArenaPlayerView(
            player.SessionId,
            player.Side,
            player.X,
            player.Y,
            player.Vx,
            player.Vy,
            player.AimX,
            player.AimY,
            ArenaRulesetV1.ChargePermille(player.ChargeTicks),
            player.ForcedFireTicks > 0 ? player.ForcedFireTicks : null,
            player.CooldownTicks,
            player.DashAvailable,
            acknowledgedInputs is not null && acknowledgedInputs.TryGetValue(player.SessionId, out var sequence)
                ? sequence
                : null)).ToArray(),
        _projectiles.Select(projectile => new ArenaProjectileView(
            projectile.Id,
            projectile.OwnerSessionId,
            projectile.X,
            projectile.Y,
            projectile.Vx,
            projectile.Vy,
            projectile.ChargePermille)).ToArray());
}
