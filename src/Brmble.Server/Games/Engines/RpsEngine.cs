using System.Text.Json;

namespace Brmble.Server.Games.Engines;

/// <summary>
/// Rock-Paper-Scissors — the framework's first <see cref="InteractionModel.SimultaneousCommit"/>
/// game. Both players commit a hidden pick within a shared round window; the round
/// resolves once both have committed (or the window times out). First to a majority
/// of a best-of-N series wins. Ties replay the round.
/// </summary>
public sealed class RpsEngine : IGameEngine
{
    private const int DefaultBestOf = 3;
    private static readonly int[] AllowedBestOf = { 3, 5, 7 };

    public string GameType => "rps";
    public InteractionModel InteractionModel => InteractionModel.SimultaneousCommit;

    private enum Throw { Rock, Paper, Scissors }

    private sealed class State
    {
        public required long[] Players;
        public int BestOf;
        public int TargetWins;
        public readonly int[] RoundWins = new int[2];
        public int RoundNumber = 1;          // decisive-round counter (ties don't advance it)
        public readonly Throw?[] Picks = new Throw?[2];
        public long? WinnerId;
        public int ConsecutiveDoubleTimeouts;   // back-to-back rounds where both idle
        public bool Drawn;                        // match ended in a mutual-AFK draw
        public LastRound? Last;
        // Per-player throw tallies keyed by session id for flavour stats.
        public readonly Dictionary<long, int[]> Throws = new();
    }

    private sealed record LastRound(int RoundNumber, Throw P0, Throw P1, long? WinnerId, bool Tie);

    public object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng, IReadOnlyDictionary<string, object?>? options)
    {
        if (players.Count != 2) throw new InvalidGameActionException("RPS requires exactly 2 players.");
        var bestOf = ParseBestOf(options);
        return new State
        {
            Players = new[] { players[0].UserId, players[1].UserId },
            BestOf = bestOf,
            TargetWins = bestOf / 2 + 1,
            Throws =
            {
                [players[0].UserId] = new int[3],
                [players[1].UserId] = new int[3],
            },
        };
    }

    private static int ParseBestOf(IReadOnlyDictionary<string, object?>? options)
    {
        if (options is null || !options.TryGetValue("bestOf", out var raw) || raw is null)
            return DefaultBestOf;
        int value = raw switch
        {
            int i => i,
            long l => (int)l,
            string s when int.TryParse(s, out var p) => p,
            JsonElement e when e.ValueKind == JsonValueKind.Number => e.GetInt32(),
            JsonElement e when e.ValueKind == JsonValueKind.String && int.TryParse(e.GetString(), out var p) => p,
            _ => DefaultBestOf,
        };
        return Array.IndexOf(AllowedBestOf, value) >= 0 ? value : DefaultBestOf;
    }

    private int IndexOf(State s, long userId)
    {
        if (s.Players[0] == userId) return 0;
        if (s.Players[1] == userId) return 1;
        return -1;
    }

    public bool IsUsersTurn(object state, long userId)
    {
        var s = (State)state;
        if (s.WinnerId is not null) return false;
        var idx = IndexOf(s, userId);
        return idx >= 0 && s.Picks[idx] is null;
    }

    public IReadOnlyList<GameEvent> ApplyAction(object state, long userId, IReadOnlyDictionary<string, object?> action, IRandomSource rng)
    {
        var s = (State)state;
        if (s.WinnerId is not null) throw new InvalidGameActionException("Game already finished.");
        var idx = IndexOf(s, userId);
        if (idx < 0) throw new InvalidGameActionException("You are not in this match.");
        if (s.Picks[idx] is not null) throw new InvalidGameActionException("You already picked this round.");
        if (!TryParseThrow(action, out var pick)) throw new InvalidGameActionException("Invalid pick.");

        s.Picks[idx] = pick;
        s.Throws[userId][(int)pick]++;

        // Round only resolves once both players have committed.
        if (s.Picks[0] is null || s.Picks[1] is null)
            return new[] { Event("committed", ("userId", userId)) };

        return ResolveRound(s);
    }

    public IReadOnlyList<GameEvent> ApplyTimeoutPenalty(object state, IRandomSource rng)
    {
        var s = (State)state;
        if (s.WinnerId is not null) return Array.Empty<GameEvent>();
        // Non-committers auto-lose the round. If both failed to pick it's a draw and
        // the round replays; otherwise the committer takes the round.
        return ResolveRound(s, timeout: true);
    }

    private IReadOnlyList<GameEvent> ResolveRound(State s, bool timeout = false)
    {
        var p0 = s.Picks[0];
        var p1 = s.Picks[1];
        long? roundWinner;
        bool tie;

        if (p0 is null && p1 is null)
        {
            // Both idle on timeout: draw, replay the same round number. After two
            // consecutive idle rounds, end the whole match as a draw (anti-grief).
            roundWinner = null;
            tie = true;
            s.ConsecutiveDoubleTimeouts++;
            if (s.ConsecutiveDoubleTimeouts >= 2) s.Drawn = true;
        }
        else if (p0 is null)
        {
            roundWinner = s.Players[1];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else if (p1 is null)
        {
            roundWinner = s.Players[0];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else if (p0 == p1)
        {
            roundWinner = null;
            tie = true;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else
        {
            var zeroBeatsOne = Beats(p0.Value, p1.Value);
            roundWinner = zeroBeatsOne ? s.Players[0] : s.Players[1];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }

        // Use a neutral placeholder for reveal when a player timed out without a pick.
        var reveal0 = p0 ?? Throw.Rock;
        var reveal1 = p1 ?? Throw.Rock;
        var recordedRound = s.RoundNumber;
        s.Last = new LastRound(recordedRound, reveal0, reveal1, roundWinner, tie);

        var events = new List<GameEvent>();
        if (!tie && roundWinner is not null)
        {
            var widx = IndexOf(s, roundWinner.Value);
            s.RoundWins[widx]++;
            s.RoundNumber++;
        }

        events.Add(new GameEvent("roundResult", new Dictionary<string, object>
        {
            ["roundNumber"] = recordedRound,
            ["p0"] = s.Players[0],
            ["pick0"] = p0?.ToString().ToLowerInvariant() ?? "none",
            ["p1"] = s.Players[1],
            ["pick1"] = p1?.ToString().ToLowerInvariant() ?? "none",
            ["winnerId"] = roundWinner ?? 0L,
            ["tie"] = tie,
            ["timeout"] = timeout,
            ["wins0"] = s.RoundWins[0],
            ["wins1"] = s.RoundWins[1],
        }));

        // Match over?
        if (s.RoundWins[0] >= s.TargetWins) s.WinnerId = s.Players[0];
        else if (s.RoundWins[1] >= s.TargetWins) s.WinnerId = s.Players[1];

        // Clear picks for the next round.
        s.Picks[0] = null;
        s.Picks[1] = null;
        return events;
    }

    private static bool Beats(Throw a, Throw b) =>
        (a == Throw.Rock && b == Throw.Scissors) ||
        (a == Throw.Scissors && b == Throw.Paper) ||
        (a == Throw.Paper && b == Throw.Rock);

    public GameOutcome GetOutcome(object state)
    {
        var s = (State)state;
        if (s.Drawn)
        {
            return new GameOutcome.Finished(new[]
            {
                new CompletedParticipant(s.Players[0], Placement: 1, Score: s.RoundWins[0], Result: "draw"),
                new CompletedParticipant(s.Players[1], Placement: 1, Score: s.RoundWins[1], Result: "draw"),
            });
        }
        if (s.WinnerId is null) return new GameOutcome.InProgress();
        var winnerId = s.WinnerId.Value;
        var loserId = s.Players[0] == winnerId ? s.Players[1] : s.Players[0];
        var wIdx = IndexOf(s, winnerId);
        var lIdx = IndexOf(s, loserId);
        return new GameOutcome.Finished(new[]
        {
            new CompletedParticipant(winnerId, Placement: 1, Score: s.RoundWins[wIdx], Result: "win"),
            new CompletedParticipant(loserId, Placement: 2, Score: s.RoundWins[lIdx], Result: "loss"),
        });
    }

    public object PublicView(object state, long forUserId)
    {
        var s = (State)state;
        var idx = IndexOf(s, forUserId);
        return new
        {
            players = s.Players,
            bestOf = s.BestOf,
            targetWins = s.TargetWins,
            roundNumber = s.RoundNumber,
            roundWins = s.RoundWins,
            finished = s.WinnerId is not null,
            winnerId = s.WinnerId,
            // Reveal only the requesting player's own current pick; the opponent's is
            // hidden (boolean only) until the round resolves.
            myPick = idx >= 0 ? s.Picks[idx]?.ToString().ToLowerInvariant() : null,
            opponentPicked = idx >= 0 && s.Picks[idx ^ 1] is not null,
            lastRound = s.Last is null ? null : new
            {
                roundNumber = s.Last.RoundNumber,
                p0 = s.Players[0],
                pick0 = s.Last.P0.ToString().ToLowerInvariant(),
                p1 = s.Players[1],
                pick1 = s.Last.P1.ToString().ToLowerInvariant(),
                winnerId = s.Last.WinnerId,
                tie = s.Last.Tie,
            },
        };
    }

    public string MatchFormat(object state) => $"bo{((State)state).BestOf}";

    public string? StartFeedLine(object state, Func<long, string> nameOf)
    {
        var s = (State)state;
        return $"✊✋✌️ {nameOf(s.Players[0])} vs {nameOf(s.Players[1])} — Rock Paper Scissors (best of {s.BestOf}) started";
    }

    public string? EventFeedLine(GameEvent e, Func<long, string> nameOf)
    {
        if (e.Kind != "roundResult") return null;
        var round = e.Data["roundNumber"];
        var p0 = Convert.ToInt64(e.Data["p0"]);
        var p1 = Convert.ToInt64(e.Data["p1"]);
        var pick0 = e.Data["pick0"];
        var pick1 = e.Data["pick1"];
        var tie = e.Data["tie"] is bool b && b;
        var wins0 = e.Data["wins0"];
        var wins1 = e.Data["wins1"];
        if (tie)
            return $"{Glyph(pick0)} Round {round}: {nameOf(p0)} and {nameOf(p1)} both picked {pick0} — tie, replay";
        var winnerId = Convert.ToInt64(e.Data["winnerId"]);
        var loserId = winnerId == p0 ? p1 : p0;
        var winnerPick = winnerId == p0 ? pick0 : pick1;
        var loserPick = winnerId == p0 ? pick1 : pick0;
        return $"{Glyph(winnerPick)} Round {round}: {nameOf(winnerId)}'s {winnerPick} beats {nameOf(loserId)}'s {loserPick} ({wins0}–{wins1})";
    }

    /// <summary>Feed glyph for a throw ("rock"/"paper"/"scissors"), matching the
    /// ✊✋✌️ set used in the start line. Falls back to the fist for unknown values.</summary>
    private static string Glyph(object? pick) => pick?.ToString() switch
    {
        "rock" => "✊",
        "paper" => "✋",
        "scissors" => "✌️",
        _ => "✊",
    };

    public string? EndFeedLine(object state, Func<long, string> nameOf)
    {
        var s = (State)state;
        if (s.Drawn)
            return $"✊✋✌️ {nameOf(s.Players[0])} vs {nameOf(s.Players[1])} — Rock Paper Scissors ended in a draw (both idle)";
        if (s.WinnerId is null) return null;
        var winner = s.WinnerId.Value;
        var wIdx = IndexOf(s, winner);
        return $"🏆 {nameOf(winner)} wins Rock Paper Scissors {s.RoundWins[wIdx]}–{s.RoundWins[wIdx ^ 1]}!";
    }

    public object? MatchSummary(object state)
    {
        var s = (State)state;
        return new
        {
            bestOf = s.BestOf,
            roundsPlayed = s.RoundWins[0] + s.RoundWins[1],
        };
    }

    public object? ParticipantStats(object state, long userId)
    {
        var s = (State)state;
        if (!s.Throws.TryGetValue(userId, out var t)) return null;
        var favIdx = 0;
        for (var i = 1; i < 3; i++) if (t[i] > t[favIdx]) favIdx = i;
        var total = t[0] + t[1] + t[2];
        return new
        {
            rock = t[0],
            paper = t[1],
            scissors = t[2],
            favoriteThrow = total == 0 ? null : ((Throw)favIdx).ToString().ToLowerInvariant(),
        };
    }

    private static bool TryParseThrow(IReadOnlyDictionary<string, object?> action, out Throw pick)
    {
        pick = Throw.Rock;
        if (!action.TryGetValue("pick", out var raw) || raw is null) return false;
        var text = raw switch
        {
            string s => s,
            JsonElement e when e.ValueKind == JsonValueKind.String => e.GetString(),
            _ => null,
        };
        switch (text?.ToLowerInvariant())
        {
            case "rock": pick = Throw.Rock; return true;
            case "paper": pick = Throw.Paper; return true;
            case "scissors": pick = Throw.Scissors; return true;
            default: return false;
        }
    }

    private static GameEvent Event(string kind, params (string, object)[] data)
        => new(kind, data.ToDictionary(d => d.Item1, d => d.Item2));
}
