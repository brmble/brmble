namespace Brmble.Server.Games.Duels;

public sealed record DuelConfiguration(
    string GameType,
    string Format,
    int RulesetVersion,
    IReadOnlyDictionary<string, object?> Options,
    string RunnerKey);

public interface IDuelGameDefinition
{
    string GameType { get; }
    string RunnerKey { get; }
    int RulesetVersion { get; }
    IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options);
    string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions);
}

public sealed record DuelPlayer(long SessionId, long UserId, string DisplayName);

public sealed record DuelReservation(
    long ReservationId,
    int ChannelId,
    DuelPlayer PlayerOne,
    DuelPlayer PlayerTwo,
    DuelConfiguration Configuration,
    DateTimeOffset AcceptedAt,
    long AcceptanceSequence,
    long? SourceMatchId);

public enum DuelCommitmentKind { Challenge, RematchOffer, Queued, ReadyCheck, Active }
public enum DuelCancelReason { Declined, Expired, Disconnected, LeftChannel, ChannelRemoved, StartFailed }
public enum ReadyResponse { Accept, Decline }
public enum DuelRejectReason { None, Blocked, AlreadyCommitted, NotPresent, StaleOffer, NotParticipant, InvalidConfiguration }
public enum EstimateStatus { Known, Unknown }
public enum EstimateMethod { FullMedian, ConditionalRemaining, FullMedianFallback, ReadyWindow, Insufficient }

public sealed record DuelCommandResult(
    bool Success, long? OfferId, long? ReservationId, string? Error, DuelRejectReason Reason);

public sealed record ActiveMatchReference(long MatchId, long ReservationId, int ChannelId, string RunnerKey);
public sealed record GameStartResult(bool Success, long MatchId, DateTimeOffset? StartedAt, string? Error);

public sealed record MatchCompletion(
    long MatchId,
    long ReservationId,
    int ChannelId,
    DuelPlayer PlayerOne,
    DuelPlayer PlayerTwo,
    DuelConfiguration Configuration,
    DateTimeOffset EndedAt);

public sealed record DurationSample(long MatchId, long DurationMs, string Outcome, DateTimeOffset EndedAt);

public interface IDuelMatchRunner
{
    string RunnerKey { get; }
    event Func<MatchCompletion, Task>? MatchCompleted;
    Task<GameStartResult> StartAsync(DuelReservation reservation);
    bool TryGetActiveMatch(long userId, out ActiveMatchReference match);
    Task ForfeitAsync(long matchId, long userId, string reason);
}

public interface IDuelMatchRunnerRouter
{
    event Func<MatchCompletion, Task>? MatchCompleted;
    Task<GameStartResult> StartAsync(DuelReservation reservation);
    bool TryGetActiveMatch(long userId, out ActiveMatchReference match);
    Task ForfeitAsync(long matchId, long userId, string reason);
}

public interface IDuelOrchestrator
{
    Task<DuelCommandResult> CreateChallengeAsync(
        long inviterSessionId,
        long targetSessionId,
        string gameType,
        IReadOnlyDictionary<string, object?>? options);
    Task<DuelCommandResult> RespondToOfferAsync(long offerId, long responderUserId, bool accept);
    Task<DuelCommandResult> CancelOfferAsync(long offerId, long requesterUserId);
    Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response);
    Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId);
    Task<DuelQueueSnapshot> GetSnapshotForSessionAsync(long sessionId);
    Task HandlePresenceLostAsync(long userId, long oldSessionId, DuelCancelReason reason);
    Task HandleChannelRemovedAsync(int channelId);
}

public sealed record DuelPlayerSnapshot(long UserId, long SessionId, string DisplayName, bool Ready = false);

public sealed record EtaSegmentSnapshot(
    string GameType, string Format, int RulesetVersion, int SampleCount, EstimateMethod Method);

public sealed record DurationEstimate(
    EstimateStatus Status, long? Milliseconds, int SampleCount, EstimateMethod Method, bool Approximate)
{
    public static DurationEstimate Known(long milliseconds, int count, EstimateMethod method) =>
        new(EstimateStatus.Known, milliseconds, count, method, true);

    public static DurationEstimate Unknown(int count) =>
        new(EstimateStatus.Unknown, null, count, EstimateMethod.Insufficient, true);
}

public sealed record QueueEtaSnapshot(
    EstimateStatus Status,
    DateTimeOffset? EstimatedStartAt,
    long? Milliseconds,
    bool Approximate,
    IReadOnlyList<EtaSegmentSnapshot> Segments);

public sealed record ActiveDuelSnapshot(
    long MatchId,
    string Status,
    DateTimeOffset StartedAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimate Remaining);

public sealed record ReadyCheckSnapshot(
    long ReservationId,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion);

public sealed record QueuedDuelSnapshot(
    long ReservationId,
    int Position,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    QueueEtaSnapshot Eta);

public sealed record DuelQueueSnapshot(
    int SchemaVersion,
    long Generation,
    long Revision,
    int ChannelId,
    DateTimeOffset GeneratedAt,
    long CalculationTimeMs,
    ActiveDuelSnapshot? Active,
    ReadyCheckSnapshot? ReadyCheck,
    IReadOnlyList<QueuedDuelSnapshot> Queue);

public sealed record ActiveSnapshotInput(DuelConfiguration Configuration, DateTimeOffset StartedAt);
public sealed record ReadySnapshotInput(DuelReservation Reservation, DateTimeOffset ExpiresAt);

public sealed record ChannelSnapshotInput(
    int ChannelId,
    long Generation,
    long Revision,
    DateTimeOffset CalculatedAt,
    ActiveSnapshotInput? Active,
    ReadySnapshotInput? ReadyCheck,
    IReadOnlyList<DuelReservation> Queue);

public interface IDurationSampleRepository
{
    Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs);
}
