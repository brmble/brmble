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
    object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng);

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
}

public sealed class InvalidGameActionException : Exception
{
    public InvalidGameActionException(string message) : base(message) { }
}
