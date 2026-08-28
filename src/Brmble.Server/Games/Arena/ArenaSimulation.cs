using System.Buffers.Binary;
using System.Collections.ObjectModel;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Arena;

public sealed class ArenaSimulation : IContinuousSimulation
{
    private static readonly ContinuousInput NeutralInput =
        new(0, 0, 0, 0, 32767, 0, false, false, false);

    private readonly HashSet<long> _readySessionIds = [];
    private readonly HashSet<long> _fireReleasedSessionIds = [];
    private readonly HashSet<long> _dashSessionIds = [];
    private readonly HashSet<long> _forcedFireSessionIds = [];
    private readonly HashSet<long> _hitProjectileIds = [];
    private readonly int[] _score = [0, 0];
    private readonly int[] _shots = [0, 0];
    private readonly int[] _hits = [0, 0];
    private readonly int[] _dashUses = [0, 0];
    private readonly List<int>[] _firedCharges = [[], []];
    private readonly List<int>[] _landedCharges = [[], []];
    private readonly List<int> _roundDurations = [];
    private readonly List<ArenaKnockoutCause> _koCauses = [];
    private readonly List<int> _koRadii = [];
    private readonly List<ArenaProjectile> _projectiles = [];
    private readonly long[] _userIdsBySide;
    private readonly ArenaKnockoutCause?[] _boundaryCauses = [null, null];
    private int _phaseTick;
    private int _liveTick;
    private int _consecutiveDoubleKos;
    private int _doubleKoReplays;
    private long _nextProjectileId = 1;
    private ContinuousCompletion? _completion;
    private bool _roundResetThisTick;

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
        _userIdsBySide = Players.Select(player => player.SessionId == reservation.PlayerOne.SessionId
            ? reservation.PlayerOne.UserId
            : reservation.PlayerTwo.UserId).ToArray();
    }

    public long Tick { get; private set; }
    public ContinuousMatchPhase Phase { get; private set; } = ContinuousMatchPhase.AwaitingParticipants;
    public ArenaPlayerState[] Players { get; }
    public IReadOnlyList<int> Score => _score;
    public IReadOnlyList<ArenaProjectile> Projectiles => _projectiles;
    public int ArenaRadius { get; private set; } = ArenaRulesetV1.InitialArenaRadius;
    public int ConsecutiveDoubleKos => _consecutiveDoubleKos;
    public long RoundGeneration { get; private set; }
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

    public void SetInput(long sessionId, ContinuousInput input)
    {
        var player = FindPlayer(sessionId);
        player.Input = input with
        {
            FireReleased = input.FireReleased || player.Input.FireReleased,
            Dash = input.Dash || player.Input.Dash,
        };
    }

    public void SetNeutralInput(long sessionId)
    {
        var player = FindPlayer(sessionId);
        player.Input = player.Input with
        {
            MoveX = 0,
            MoveY = 0,
            Charging = false,
        };
    }

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

        return _completion is null
            ? new ContinuousStepResult(false, null)
            : new ContinuousStepResult(true, _completion);
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
        var bytes = new List<byte>(512);
        Write(Tick); Write((int)Phase); Write(_phaseTick); Write(_liveTick); Write(ArenaRadius);
        Write(_consecutiveDoubleKos); Write(_doubleKoReplays); Write(_nextProjectileId);
        WriteBool(_roundResetThisTick); Write(RoundGeneration);
        foreach (var userId in _userIdsBySide) Write(userId);
        foreach (var value in _score) Write(value);
        foreach (var value in _shots) Write(value);
        foreach (var value in _hits) Write(value);
        foreach (var value in _dashUses) Write(value);
        foreach (var player in Players.OrderBy(x => x.SessionId))
        {
            Write(player.SessionId); Write(player.Side); Write(player.X); Write(player.Y);
            Write(player.Vx); Write(player.Vy); Write(player.AimX); Write(player.AimY);
            Write(player.ChargeTicks); Write(player.ForcedFireTicks); Write(player.CooldownTicks);
            Write(player.DashTicks); WriteBool(player.DashAvailable); Write((int)player.VelocityCause);
            Write(player.BoundaryCause is null ? -1 : (int)player.BoundaryCause.Value);
            Write(player.Input.Sequence); Write(player.Input.PredictedTick);
            Write(player.Input.MoveX); Write(player.Input.MoveY); Write(player.Input.AimX); Write(player.Input.AimY);
            WriteBool(player.Input.Charging); WriteBool(player.Input.FireReleased); WriteBool(player.Input.Dash);
        }
        foreach (var projectile in _projectiles.OrderBy(x => x.Id))
        {
            Write(projectile.Id); Write(projectile.OwnerSessionId); Write(projectile.X); Write(projectile.Y);
            Write(projectile.Vx); Write(projectile.Vy); Write(projectile.ChargePermille);
        }
        WriteSet(_readySessionIds); WriteSet(_fireReleasedSessionIds); WriteSet(_dashSessionIds);
        WriteSet(_forcedFireSessionIds); WriteSet(_hitProjectileIds);
        foreach (var list in _firedCharges) { Write(list.Count); foreach (var value in list) Write(value); }
        foreach (var list in _landedCharges) { Write(list.Count); foreach (var value in list) Write(value); }
        Write(_roundDurations.Count); foreach (var value in _roundDurations) Write(value);
        Write(_koCauses.Count); foreach (var value in _koCauses) Write((int)value);
        Write(_koRadii.Count); foreach (var value in _koRadii) Write(value);
        foreach (var cause in _boundaryCauses) Write(cause is null ? -1 : (int)cause.Value);
        WriteBool(_completion is not null);
        return FixedVec.Fnv1a64(bytes.ToArray());

        void WriteSet(IEnumerable<long> values) { var ordered = values.Order().ToArray(); Write(ordered.Length); foreach (var value in ordered) Write(value); }
        void WriteBool(bool value) => Write(value ? 1 : 0);
        void Write(long value) { var buffer = new byte[sizeof(long)]; BinaryPrimitives.WriteInt64LittleEndian(buffer, value); bytes.AddRange(buffer); }
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
            player.BoundaryCause = null;
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

            if (Phase != ContinuousMatchPhase.Live || player.CooldownTicks > 0)
            {
                player.ChargeTicks = 0;
                player.ForcedFireTicks = 0;
                _forcedFireSessionIds.Remove(player.SessionId);
            }
            else if (player.Input.Charging)
            {
                if (player.ChargeTicks < ArenaRulesetV1.ChargeTicks)
                {
                    player.ChargeTicks++;
                    if (player.ChargeTicks == ArenaRulesetV1.ChargeTicks)
                    {
                        player.ForcedFireTicks = ArenaRulesetV1.ForcedFireTicks;
                        _forcedFireSessionIds.Add(player.SessionId);
                    }
                }
            }
        }
    }

    private void ProcessDashEdges()
    {
        foreach (var player in Players)
        {
            var risingEdge = player.Input.Dash && !_dashSessionIds.Contains(player.SessionId);
            if (risingEdge && Phase == ContinuousMatchPhase.Live && player.DashAvailable)
            {
                player.DashAvailable = false;
                player.DashTicks = ArenaRulesetV1.DashTicks;
                _dashUses[player.Side] = checked(_dashUses[player.Side] + 1);
            }

            if (player.Input.Dash)
                _dashSessionIds.Add(player.SessionId);
            else
                _dashSessionIds.Remove(player.SessionId);

            player.Input = player.Input with { Dash = false };
        }
    }

    private void ProcessFire()
    {
        foreach (var player in Players)
        {
            var releaseEdge = player.Input.FireReleased
                && !_fireReleasedSessionIds.Contains(player.SessionId);
            var forcedFire = _forcedFireSessionIds.Contains(player.SessionId)
                && player.ForcedFireTicks == 0;

            if (Phase == ContinuousMatchPhase.Live
                && player.CooldownTicks == 0
                && (releaseEdge || forcedFire))
            {
                Fire(player);
            }

            if (player.Input.FireReleased)
                _fireReleasedSessionIds.Add(player.SessionId);
            else
                _fireReleasedSessionIds.Remove(player.SessionId);

            player.Input = player.Input with { FireReleased = false };
        }
    }

    private void Fire(ArenaPlayerState player)
    {
        var aim = new FixedVec(player.AimX, player.AimY);
        var spawnOffset = aim.Scale(ArenaRulesetV1.PlayerRadius + ArenaRulesetV1.ProjectileRadius);
        var velocity = aim.Scale(ArenaRulesetV1.ProjectilePerTick);
        var chargePermille = ArenaRulesetV1.ChargePermille(player.ChargeTicks);
        var recoil = aim.Scale(ArenaRulesetV1.Recoil(chargePermille));

        _projectiles.Add(new ArenaProjectile(
            _nextProjectileId,
            player.SessionId,
            checked(player.X + spawnOffset.X),
            checked(player.Y + spawnOffset.Y),
            velocity.X,
            velocity.Y,
            chargePermille));
        _nextProjectileId = checked(_nextProjectileId + 1);
        player.Vx = checked(player.Vx - recoil.X);
        player.Vy = checked(player.Vy - recoil.Y);
        player.VelocityCause = ArenaKnockoutCause.Recoil;
        player.ChargeTicks = 0;
        player.ForcedFireTicks = 0;
        player.CooldownTicks = ArenaRulesetV1.ShotCooldownTicks;
        _forcedFireSessionIds.Remove(player.SessionId);
        _shots[player.Side] = checked(_shots[player.Side] + 1);
        _firedCharges[player.Side].Add(chargePermille);
    }

    private void ApplyMovement()
    {
        if (Phase == ContinuousMatchPhase.Loading)
            return;

        foreach (var player in Players)
        {
            var wasInside = IsInsideArena(player.X, player.Y);
            var chargePermille = ArenaRulesetV1.ChargePermille(player.ChargeTicks);
            var displacement = new FixedVec(player.Input.MoveX, player.Input.MoveY)
                .Scale(ArenaRulesetV1.MovePerTick(chargePermille));
            player.X = checked(player.X + displacement.X);
            player.Y = checked(player.Y + displacement.Y);
            RecordBoundaryTransition(player, wasInside, ArenaKnockoutCause.DashOrMovement);
        }
    }

    private void ApplyDashMovement()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        foreach (var player in Players)
        {
            if (player.DashTicks == 0)
                continue;

            var wasInside = IsInsideArena(player.X, player.Y);
            var direction = player.Input.MoveX == 0 && player.Input.MoveY == 0
                ? new FixedVec(player.AimX, player.AimY)
                : new FixedVec(player.Input.MoveX, player.Input.MoveY);
            var displacement = direction.Scale(ArenaRulesetV1.DashPerTick);
            player.X = checked(player.X + displacement.X);
            player.Y = checked(player.Y + displacement.Y);
            RecordBoundaryTransition(player, wasInside, ArenaKnockoutCause.DashOrMovement);
            player.DashTicks = checked(player.DashTicks - 1);
        }
    }

    private void IntegrateVelocity()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        foreach (var player in Players)
        {
            var wasInside = IsInsideArena(player.X, player.Y);
            player.X = checked(player.X + player.Vx);
            player.Y = checked(player.Y + player.Vy);
            RecordBoundaryTransition(player, wasInside, player.VelocityCause);
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
        var lowWasInside = IsInsideArena(low.X, low.Y);
        var highWasInside = IsInsideArena(high.X, high.Y);

        low.X = checked(low.X - (int)(normal.X * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
        low.Y = checked(low.Y - (int)(normal.Y * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
        high.X = checked(high.X + (int)(normal.X * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
        high.Y = checked(high.Y + (int)(normal.Y * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
        RecordBoundaryTransition(low, lowWasInside, ArenaKnockoutCause.DashOrMovement);
        RecordBoundaryTransition(high, highWasInside, ArenaKnockoutCause.DashOrMovement);
    }

    private void AdvanceProjectilesAndResolveHits()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        for (var index = 0; index < _projectiles.Count; index++)
        {
            var projectile = _projectiles[index];
            projectile = projectile with
            {
                X = checked(projectile.X + projectile.Vx),
                Y = checked(projectile.Y + projectile.Vy),
            };
            _projectiles[index] = projectile;

            var opponent = Players[0].SessionId == projectile.OwnerSessionId
                ? Players[1]
                : Players[0];
            var dx = checked((long)opponent.X - projectile.X);
            var dy = checked((long)opponent.Y - projectile.Y);
            var hitRadius = ArenaRulesetV1.PlayerRadius + ArenaRulesetV1.ProjectileRadius;
            if (checked(dx * dx + dy * dy) > checked((long)hitRadius * hitRadius))
                continue;

            var speed = FixedVec.IntegerSqrt(checked(
                (long)projectile.Vx * projectile.Vx + (long)projectile.Vy * projectile.Vy));
            var direction = new FixedVec(
                checked((int)(projectile.Vx * (long)ArenaRulesetV1.AimQuantizationMax / speed)),
                checked((int)(projectile.Vy * (long)ArenaRulesetV1.AimQuantizationMax / speed)));
            var impulse = direction.Scale(ArenaRulesetV1.Knockback(projectile.ChargePermille));
            opponent.Vx = checked(opponent.Vx + impulse.X);
            opponent.Vy = checked(opponent.Vy + impulse.Y);
            opponent.VelocityCause = ArenaKnockoutCause.OpponentProjectile;
            _hitProjectileIds.Add(projectile.Id);
            var ownerSide = opponent.Side == 0 ? 1 : 0;
            _hits[ownerSide] = checked(_hits[ownerSide] + 1);
            _landedCharges[ownerSide].Add(projectile.ChargePermille);
        }
    }

    private void RemoveExpiredProjectiles()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        _projectiles.RemoveAll(projectile =>
            _hitProjectileIds.Contains(projectile.Id) || !IsInsideArena(projectile.X, projectile.Y));
        _hitProjectileIds.Clear();
    }

    private void UpdateShrink()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        var previousRadius = ArenaRadius;
        _liveTick = checked(_liveTick + 1);
        ArenaRadius = ArenaRulesetV1.ArenaRadius(_liveTick);
        foreach (var player in Players)
        {
            var distanceSquared = checked((long)player.X * player.X + (long)player.Y * player.Y);
            if (distanceSquared <= checked((long)previousRadius * previousRadius)
                && distanceSquared > checked((long)ArenaRadius * ArenaRadius))
                player.BoundaryCause = ArenaKnockoutCause.Collapse;
        }
    }

    private void EvaluatePlayerBoundaries()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        for (var index = 0; index < Players.Length; index++)
        {
            var player = Players[index];
            if (IsInsideArena(player.X, player.Y))
            {
                _boundaryCauses[index] = null;
                continue;
            }

            _boundaryCauses[index] = player.BoundaryCause ?? ArenaKnockoutCause.DashOrMovement;
        }
    }

    private void ResolveRound()
    {
        if (Phase != ContinuousMatchPhase.Live)
            return;

        var outside = Enumerable.Range(0, Players.Length).Where(index => _boundaryCauses[index] is not null).ToArray();
        if (outside.Length == 0)
            return;

        _roundDurations.Add(_liveTick);
        foreach (var index in outside)
        {
            _koCauses.Add(_boundaryCauses[index]!.Value);
            _koRadii.Add(ArenaRadius);
        }

        if (outside.Length == Players.Length)
        {
            _consecutiveDoubleKos = checked(_consecutiveDoubleKos + 1);
            _doubleKoReplays = checked(_doubleKoReplays + 1);
            if (_consecutiveDoubleKos > ArenaRulesetV1.MaxConsecutiveDoubleKos)
                Complete("draw");
            else
                ResetRound();
            return;
        }

        _consecutiveDoubleKos = 0;
        var winnerSide = outside[0] == 0 ? 1 : 0;
        _score[winnerSide] = checked(_score[winnerSide] + 1);
        if (_score[winnerSide] == ArenaRulesetV1.TargetRoundWins)
            Complete("decided");
        else
            ResetRound();
    }

    private void FinishTickAndPhase()
    {
        Tick = checked(Tick + 1);
        if (_roundResetThisTick)
        {
            _roundResetThisTick = false;
            return;
        }
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

    private void ResetRound()
    {
        RoundGeneration = checked(RoundGeneration + 1);
        _roundResetThisTick = true;
        Phase = ContinuousMatchPhase.Loading;
        _phaseTick = 0;
        _liveTick = 0;
        ArenaRadius = ArenaRulesetV1.InitialArenaRadius;
        _projectiles.Clear();
        _hitProjectileIds.Clear();
        _fireReleasedSessionIds.Clear();
        _dashSessionIds.Clear();
        _forcedFireSessionIds.Clear();
        Array.Clear(_boundaryCauses);
        foreach (var player in Players)
        {
            player.X = player.Side == 0 ? -ArenaRulesetV1.SpawnOffset : ArenaRulesetV1.SpawnOffset;
            player.Y = 0; player.Vx = 0; player.Vy = 0;
            player.AimX = player.Side == 0 ? ArenaRulesetV1.AimQuantizationMax : -ArenaRulesetV1.AimQuantizationMax;
            player.AimY = 0; player.ChargeTicks = 0; player.ForcedFireTicks = 0;
            player.CooldownTicks = 0; player.DashTicks = 0; player.DashAvailable = true;
            player.Input = NeutralInput; player.VelocityCause = ArenaKnockoutCause.DashOrMovement;
            player.BoundaryCause = null;
        }
    }

    private void Complete(string outcome)
    {
        Phase = ContinuousMatchPhase.Ended;
        _phaseTick = 0;
        var participants = Players.Select(player => new CompletedParticipant(
            _userIdsBySide[player.Side],
            outcome == "draw" ? 1 : _score[player.Side] == ArenaRulesetV1.TargetRoundWins ? 1 : 2,
            _score[player.Side],
            outcome == "draw" ? "draw" : _score[player.Side] == ArenaRulesetV1.TargetRoundWins ? "win" : "loss")).ToArray();
        var stats = new SortedDictionary<long, object>();
        foreach (var player in Players)
            stats.Add(_userIdsBySide[player.Side], new ArenaParticipantStats(
                _score[player.Side], _shots[player.Side], _hits[player.Side],
                Array.AsReadOnly(_firedCharges[player.Side].ToArray()),
                Array.AsReadOnly(_landedCharges[player.Side].ToArray()), _dashUses[player.Side]));
        _completion = new ContinuousCompletion(outcome, null, participants, CreateMatchSummary(),
            new ReadOnlyDictionary<long, object>(stats));
    }

    private ArenaMatchSummary CreateMatchSummary() => new(
        1, Array.AsReadOnly((int[])_score.Clone()), _roundDurations.Count, _doubleKoReplays,
        Array.AsReadOnly(_roundDurations.ToArray()), Array.AsReadOnly(_koCauses.ToArray()),
        Array.AsReadOnly((int[])_shots.Clone()), Array.AsReadOnly((int[])_hits.Clone()),
        Array.AsReadOnly(_firedCharges.Select(x => (IReadOnlyList<int>)Array.AsReadOnly(x.ToArray())).ToArray()),
        Array.AsReadOnly(_landedCharges.Select(x => (IReadOnlyList<int>)Array.AsReadOnly(x.ToArray())).ToArray()),
        Array.AsReadOnly((int[])_dashUses.Clone()), Array.AsReadOnly(_koRadii.ToArray()));

    private ArenaSnapshotView CreateSnapshot(IReadOnlyDictionary<long, long>? acknowledgedInputs) => new(
        Phase,
        Phase switch
        {
            ContinuousMatchPhase.Loading => Tick + ArenaRulesetV1.LoadingTicks - _phaseTick,
            ContinuousMatchPhase.Positioning => Tick + ArenaRulesetV1.PositioningTicks - _phaseTick,
            _ => null,
        },
        Array.AsReadOnly((int[])_score.Clone()),
        _consecutiveDoubleKos,
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
                : null)).ToList().AsReadOnly(),
        _projectiles.Select(projectile => new ArenaProjectileView(
            projectile.Id,
            projectile.OwnerSessionId,
            projectile.X,
            projectile.Y,
            projectile.Vx,
            projectile.Vy,
            projectile.ChargePermille)).ToList().AsReadOnly());

    private void RecordBoundaryTransition(
        ArenaPlayerState player, bool wasInside, ArenaKnockoutCause cause)
    {
        if (wasInside && !IsInsideArena(player.X, player.Y))
            player.BoundaryCause = cause;
    }
}
