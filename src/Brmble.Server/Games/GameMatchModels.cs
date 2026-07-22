namespace Brmble.Server.Games;

public record GameMatch(
    long Id,
    string GameType,
    int ChannelId,
    string Format,
    string Outcome,
    string? AbandonReason,
    string StartedAt,
    string EndedAt,
    long DurationMs,
    string? MetadataJson);

public record GameParticipant(
    long MatchId,
    long UserId,
    int Placement,
    int? Score,
    string Result,
    string? MetadataJson);

// Value passed from GameSessionManager to GameRepository on match completion.
public record CompletedMatch(
    string GameType,
    int ChannelId,
    string Format,
    string Outcome,               // "decided" | "draw" | "abandoned"
    string? AbandonReason,        // null unless abandoned
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    IReadOnlyList<CompletedParticipant> Participants,
    string? MetadataJson = null);

public record CompletedParticipant(
    long UserId,
    int Placement,                // 1 = winner
    int? Score,
    string Result,                // "win" | "loss" | "draw" | "abandoned"
    string? MetadataJson = null);

public record UserGameStats(
    long UserId,
    string GameType,
    int Wins,
    int Losses,
    int Draws,
    int Abandons,
    int GamesPlayed)
{
    public double WinRatio => GamesPlayed == 0 ? 0 : (double)Wins / GamesPlayed;
}
