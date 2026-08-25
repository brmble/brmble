using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Spectators;

public sealed record SpectatorSnapshotEvent(
    string Type,
    int SchemaVersion,
    long MatchId,
    int ChannelId,
    string GameType,
    string Format,
    int RulesetVersion,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence,
    DateTimeOffset GeneratedAt,
    // The `object` declaration is deliberate and load-bearing. System.Text.Json serialises
    // an `object` member by its RUNTIME type; narrowing this to any base type or marker
    // interface makes it serialise by the DECLARED type instead, silently truncating the
    // view on the wire with no warning and no exception.
    object View);

public sealed record SpectatorMatchEndedEvent(
    string Type,
    int SchemaVersion,
    long MatchId,
    int ChannelId,
    string Reason,
    long FinalSequence,
    // The `object` declaration is deliberate and load-bearing — see the note on
    // SpectatorSnapshotEvent.View. Narrowing this to a base type carrying only the winner
    // would silently drop the rest of the outcome while the existing tests stayed green.
    object Outcome);

public sealed record SpectatorClosedEvent(
    string Type,
    int ChannelId,
    string Reason);

public static class SpectatorWire
{
    public static SpectatorSnapshotEvent ToSnapshotEvent(SpectatorSnapshot s) => new(
        "game.spectatorSnapshot", s.SchemaVersion, s.MatchId, s.ChannelId, s.GameType,
        s.Format, s.RulesetVersion, s.Players, s.Sequence, s.GeneratedAt, s.View);

    public static SpectatorMatchEndedEvent ToMatchEndedEvent(
        long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome) => new(
        "game.spectatorMatchEnded", 1, matchId, channelId, Reason(reason), finalSequence, outcome);

    public static SpectatorClosedEvent ToClosedEvent(int channelId, SpectatorCloseReason reason) => new(
        "game.spectatorClosed", channelId, Reason(reason));

    public static string Reason(MatchEndReason value) => value switch
    {
        MatchEndReason.Completed => "completed",
        MatchEndReason.Forfeited => "forfeited",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Reason(SpectatorCloseReason value) => value switch
    {
        SpectatorCloseReason.Unsubscribed => "unsubscribed",
        SpectatorCloseReason.AuthorizationLost => "authorizationLost",
        SpectatorCloseReason.Disconnected => "disconnected",
        SpectatorCloseReason.ChannelRemoved => "channelRemoved",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Reason(SpectatorSubscribeReason value) => value switch
    {
        SpectatorSubscribeReason.None => "none",
        SpectatorSubscribeReason.NotPresent => "notPresent",
        SpectatorSubscribeReason.NotSameChannel => "notSameChannel",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
}
