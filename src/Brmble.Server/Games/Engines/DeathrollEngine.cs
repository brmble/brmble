using System.Linq;
using System.Text.Json;

namespace Brmble.Server.Games.Engines;

public sealed class DeathrollEngine : IGameEngine
{
    private const int StartCeiling = 100;
    private const double PenaltyFactor = 0.8; // -20% per timeout step

    public string GameType => "deathroll";
    public InteractionModel InteractionModel => InteractionModel.AlternatingTurns;

    private sealed class State
    {
        public required long[] Players;
        public int CurrentIndex;
        public int Ceiling = StartCeiling;
        public int? LastRoll;
        public long? LoserId;
        public int StartingCeiling = StartCeiling;
        public int TotalRolls;
        public readonly Dictionary<long, PlayerLuck> Luck = new();
    }

    private sealed class PlayerLuck
    {
        public int Rolls;
        public int AboveMid;
        public int BelowMid;
        public double RatioSum;
    }

    public object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng)
    {
        if (players.Count != 2) throw new InvalidGameActionException("Deathroll requires exactly 2 players.");
        return new State
        {
            Players = new[] { players[0].UserId, players[1].UserId },
            Luck =
            {
                [players[0].UserId] = new PlayerLuck(),
                [players[1].UserId] = new PlayerLuck(),
            },
        };
    }

    public bool IsUsersTurn(object state, long userId)
    {
        var s = (State)state;
        return s.LoserId is null && s.Players[s.CurrentIndex] == userId;
    }

    public IReadOnlyList<GameEvent> ApplyAction(object state, long userId, IReadOnlyDictionary<string, object?> action, IRandomSource rng)
    {
        var s = (State)state;
        if (s.LoserId is not null) throw new InvalidGameActionException("Game already finished.");
        if (s.Players[s.CurrentIndex] != userId) throw new InvalidGameActionException("Not your turn.");
        if (!action.TryGetValue("roll", out var roll) || !IsTrue(roll))
            throw new InvalidGameActionException("Unknown action.");
        return DoRoll(s, userId, rng);
    }

    // Action payloads arrive over HTTP as System.Text.Json, so a JSON `true`
    // is a JsonElement rather than a boxed bool. Accept both.
    private static bool IsTrue(object? value) => value switch
    {
        bool b => b,
        JsonElement e => e.ValueKind == JsonValueKind.True,
        _ => false,
    };

    public IReadOnlyList<GameEvent> ApplyTimeoutPenalty(object state, IRandomSource rng)
    {
        var s = (State)state;
        if (s.LoserId is not null) return Array.Empty<GameEvent>();

        var reduced = (int)Math.Floor(s.Ceiling * PenaltyFactor);
        if (reduced <= 1)
        {
            s.LastRoll = 1;
            s.LoserId = s.Players[s.CurrentIndex];
            return new[] { Event("penalty", ("ceiling", 1)), Event("forcedLoss", ("userId", s.LoserId!)) };
        }

        s.Ceiling = reduced;
        return new[] { Event("penalty", ("userId", s.Players[s.CurrentIndex]), ("ceiling", s.Ceiling)) };
    }

    private static IReadOnlyList<GameEvent> DoRoll(State s, long userId, IRandomSource rng)
    {
        var value = rng.Roll(s.Ceiling);
        var top = s.Ceiling;
        var luck = s.Luck[userId];
        luck.Rolls++;
        s.TotalRolls++;
        if (value > top / 2.0) luck.AboveMid++; else luck.BelowMid++;
        luck.RatioSum += (double)value / top;
        s.LastRoll = value;
        var events = new List<GameEvent> { Event("roll", ("userId", userId), ("value", value), ("ceiling", s.Ceiling)) };

        if (value <= 1)
        {
            s.LoserId = userId;
            events.Add(Event("loss", ("userId", userId)));
        }
        else
        {
            s.Ceiling = value;
            s.CurrentIndex ^= 1;
        }
        return events;
    }

    public GameOutcome GetOutcome(object state)
    {
        var s = (State)state;
        if (s.LoserId is null) return new GameOutcome.InProgress();

        var loserId = s.LoserId.Value;
        var winnerId = s.Players[0] == loserId ? s.Players[1] : s.Players[0];
        return new GameOutcome.Finished(new[]
        {
            new CompletedParticipant(winnerId, Placement: 1, Score: null, Result: "win"),
            new CompletedParticipant(loserId, Placement: 2, Score: s.LastRoll, Result: "loss"),
        });
    }

    public object PublicView(object state, long forUserId)
    {
        var s = (State)state;
        return new
        {
            players = s.Players,
            currentPlayer = s.LoserId is null ? s.Players[s.CurrentIndex] : (long?)null,
            ceiling = s.Ceiling,
            lastRoll = s.LastRoll,
            finished = s.LoserId is not null,
            loserId = s.LoserId,
        };
    }

    public int? CurrentCeiling(object state) => ((State)state).Ceiling;

    public string? StartFeedLine(object state, Func<long, string> nameOf)
    {
        var s = (State)state;
        return $"⚔️ {nameOf(s.Players[0])} vs {nameOf(s.Players[1])} — Deathroll started (ceiling {s.StartingCeiling})";
    }

    public string? EventFeedLine(GameEvent e, Func<long, string> nameOf) => e.Kind switch
    {
        "roll" => $"🎲 {nameOf(Convert.ToInt64(e.Data["userId"]))} rolled {e.Data["value"]} (1–{e.Data["ceiling"]})",
        "penalty" when e.Data.ContainsKey("userId") =>
            $"🎲 {nameOf(Convert.ToInt64(e.Data["userId"]))} ran out of time — ceiling drops to {e.Data["ceiling"]}",
        _ => null,
    };

    public string? EndFeedLine(object state, Func<long, string> nameOf)
    {
        var s = (State)state;
        if (s.LoserId is null) return null;
        var loser = s.LoserId.Value;
        var winner = s.Players[0] == loser ? s.Players[1] : s.Players[0];
        return $"💀 {nameOf(loser)} rolled {s.LastRoll ?? 1} — {nameOf(winner)} wins!";
    }

    public object? MatchSummary(object state)
    {
        var s = (State)state;
        return new
        {
            startingCeiling = s.StartingCeiling,
            totalRolls = s.TotalRolls,
            finalRoll = s.LoserId is not null ? s.LastRoll : (int?)null,
        };
    }

    public object? ParticipantStats(object state, long userId)
    {
        var s = (State)state;
        if (!s.Luck.TryGetValue(userId, out var luck)) return null;
        return new
        {
            rolls = luck.Rolls,
            rollsAboveMid = luck.AboveMid,
            rollsBelowMid = luck.BelowMid,
            avgRollRatio = luck.Rolls == 0 ? 0.0 : luck.RatioSum / luck.Rolls,
        };
    }

    private static GameEvent Event(string kind, params (string, object)[] data)
        => new(kind, data.ToDictionary(d => d.Item1, d => d.Item2));
}
