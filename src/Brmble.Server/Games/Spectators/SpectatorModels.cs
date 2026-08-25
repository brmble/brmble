using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Spectators;

/// <summary>Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.</summary>
public enum SpectatorTransport { DiscreteEventBus, DedicatedRealtime }

/// <summary>Frozen by the Arena plan. Only the Arena path reads this.</summary>
public enum SpectatorRole { Spectator, Participant }

/// <summary>
/// Why a subscribe attempt failed. There is deliberately no <c>MatchNotLive</c>:
/// subscribing to an idle channel is valid and returns a null match, because
/// spectating is a CHANNEL mode that outlives any single match.
/// </summary>
public enum SpectatorSubscribeReason { None, NotPresent, NotSameChannel }

/// <summary>
/// Why a subscription was torn down. There is deliberately no <c>MatchEnded</c>:
/// a match ending ends a match, not a subscription.
/// </summary>
public enum SpectatorCloseReason { Unsubscribed, AuthorizationLost, Disconnected, ChannelRemoved }

public enum MatchEndReason { Completed, Forfeited }

/// <summary>
/// What a source (today only <see cref="GameSessionManager"/>) hands to the
/// coordinator. <see cref="ParticipantUserIds"/> are stable db user ids and are
/// EXCLUDED from fan-out: a spectator who accepted a challenge is now playing the
/// match they were watching and receives <c>game.stateUpdated</c> instead.
/// </summary>
public sealed record SpectatorSourceFrame(
    long MatchId,
    int ChannelId,
    DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    IReadOnlySet<long> ParticipantUserIds,
    long Sequence,
    DateTimeOffset GeneratedAt,
    object View);

/// <summary>The spectator-facing projection of a live match.</summary>
public sealed record SpectatorSnapshot(
    int SchemaVersion,
    long MatchId,
    int ChannelId,
    string GameType,
    string Format,
    int RulesetVersion,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence,
    DateTimeOffset GeneratedAt,
    object View);

/// <summary>
/// Result of <see cref="ISpectatorCoordinator.SubscribeAsync"/>. <c>Match</c> is null
/// on success when the channel is idle — that is a valid subscription, not a failure.
/// </summary>
public sealed record SpectatorSubscribeResult(
    bool Success,
    SpectatorSnapshot? Match,
    SpectatorSubscribeReason Reason);

/// <summary>Carried unchanged from the July plan. Exists only for the Arena path; this project does not read it.</summary>
public sealed record SpectatorMatchDescriptor(
    long MatchId,
    int ChannelId,
    string GameType,
    SpectatorTransport Transport,
    IReadOnlySet<long> ParticipantUserIds);

/// <summary>Carried unchanged from the July plan. Exists only for the Arena path; this project does not read it.</summary>
public sealed record SpectatorAuthorizationResult(
    bool Authorized,
    SpectatorRole Role,
    SpectatorSubscribeReason Reason);

public interface ISpectatorCoordinator
{
    // Discrete, channel-scoped. New in this project.
    Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId);
    Task UnsubscribeAsync(long sessionId, long userId);
    Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame);
    Task EndMatchAsync(long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome);

    // Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.
    // NOTE: EndMatchAsync above diverges from that plan's three-parameter signature by
    // adding `reason` and `outcome`. Forfeits fabricate no terminal frame, so a spectator
    // needs the outcome delivered by the lifecycle call rather than inferred from a final
    // frame. Arena is unimplemented, so this costs nothing today; the three parameters
    // Arena passes keep their positions and meanings.
    Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match);
    Task<SpectatorAuthorizationResult> AuthorizeAsync(long sessionId, long userId, long matchId, SpectatorRole role);
}

public interface ISpectatorLifecycle
{
    Task HandleChannelChangedAsync(long sessionId, int newChannelId);
    Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason);
    Task HandleChannelRemovedAsync(int channelId);
    Task HandleTransportDisconnectedAsync(long userId);
}
