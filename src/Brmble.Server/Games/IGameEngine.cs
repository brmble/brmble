namespace Brmble.Server.Games;

public enum InteractionModel { AlternatingTurns, SimultaneousCommit }

public record GamePlayer(long UserId);

// Result of applying an action: new state is mutated in place on the engine's
// state object; the engine reports what happened for broadcasting.
public record GameEvent(string Kind, IReadOnlyDictionary<string, object> Data);

public abstract record GameOutcome
{
    public sealed record InProgress : GameOutcome;
    // Placements: index 0 = 1st place. Score/metadata parallel arrays keyed by UserId.
    public sealed record Finished(
        IReadOnlyList<CompletedParticipant> Participants) : GameOutcome;
}

public interface IGameEngine
{
    string GameType { get; }
    InteractionModel InteractionModel { get; }

    // Creates the initial opaque state for a match with the given ordered players.
    // `options` carries optional match parameters supplied with the invite (e.g. RPS
    // best-of-N). Engines that need no options ignore it. Default overload keeps
    // existing engines/tests source-compatible.
    object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng)
        => InitialState(players, rng, null);
    object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng, IReadOnlyDictionary<string, object?>? options)
        => InitialState(players, rng);

    // Returns true if it is this user's turn (alternating games).
    bool IsUsersTurn(object state, long userId);

    // Validates + applies the action; returns emitted events. Throws InvalidGameActionException on illegal move.
    IReadOnlyList<GameEvent> ApplyAction(object state, long userId, IReadOnlyDictionary<string, object?> action, IRandomSource rng);

    // Applies the escalating timeout penalty for the current turn's player; returns emitted events.
    IReadOnlyList<GameEvent> ApplyTimeoutPenalty(object state, IRandomSource rng);

    GameOutcome GetOutcome(object state);

    // Per-player public view (hide opponent secrets). For Deathroll everything is public.
    object PublicView(object state, long forUserId);

    // Game-specific match-level summary for persistence (metadata_json.summary).
    // Returns null when the game has no summary. Default: none.
    object? MatchSummary(object state) => null;

    // Game-specific per-player stats for persistence (metadata_json[gameType]).
    // Returns null when the game has none. Default: none.
    object? ParticipantStats(object state, long userId) => null;

    // Current ceiling/upper-bound for games that have one (e.g. Deathroll), used
    // for feed lines. Returns null when the game has no such concept. Default: none.
    int? CurrentCeiling(object state) => null;

    // --- Engine-driven spectator feed lines ---------------------------------
    // These let each engine own its feed wording so GameSessionManager stays
    // game-neutral. `nameOf` resolves a session id to a display name. Returning
    // null falls back to the manager's generic line.

    // Line broadcast when the match starts (after accept). Default: none.
    string? StartFeedLine(object state, Func<long, string> nameOf) => null;

    // Line for a non-terminal in-play event (a roll, a resolved RPS round, a
    // timeout penalty). Returning null suppresses a feed line for that event.
    string? EventFeedLine(GameEvent e, Func<long, string> nameOf) => null;

    // Line broadcast when the match ends normally (decided). Default: none.
    string? EndFeedLine(object state, Func<long, string> nameOf) => null;

    // Persisted match format tag (game_matches.format), e.g. "1v1" or "bo3".
    // Default: "1v1".
    string MatchFormat(object state) => "1v1";
}

public sealed class InvalidGameActionException : Exception
{
    public InvalidGameActionException(string message) : base(message) { }
}
