namespace Brmble.Server.Games.Spectators;

/// <summary>
/// What a non-participant may see of a live Deathroll match. Deathroll has no
/// private state — <see cref="Engines.DeathrollEngine.PublicView"/> ignores its
/// <c>forUserId</c> argument — so this carries the same information as the
/// participant view, plus a <see cref="Kind"/> discriminator that the participant
/// view has no analogue for.
/// Every player id is a Mumble SESSION id, matching the engine's state keys.
/// </summary>
public sealed record DeathrollSpectatorView(
    string Kind,
    IReadOnlyList<long> Players,
    long? CurrentPlayer,
    int Ceiling,
    int? LastRoll,
    bool Finished,
    long? LoserId);

/// <summary>A resolved RPS round. Throws are public only once the round is over.
/// <see cref="WinnerId"/> is a Mumble SESSION id.</summary>

public sealed record RpsResolvedRoundSnapshot(
    int RoundNumber,
    int Sequence,
    string Pick0,
    string Pick1,
    long? WinnerId,
    bool Tie);

/// <summary>
/// What a non-participant may see of a live RPS match. <see cref="Committed"/>
/// carries WHETHER each player has thrown, never WHAT. There is deliberately no
/// <c>Picks</c>, <c>MyPick</c> or <c>OpponentPicked</c> field: resolved throws
/// exist only inside <see cref="LastRound"/>.
/// Every player id is a Mumble SESSION id.
/// </summary>
public sealed record RpsSpectatorView(
    string Kind,
    IReadOnlyList<long> Players,
    int BestOf,
    int TargetWins,
    int RoundNumber,
    IReadOnlyList<int> RoundWins,
    IReadOnlyList<bool> Committed,
    bool Finished,
    long? WinnerId,
    RpsResolvedRoundSnapshot? LastRound);
