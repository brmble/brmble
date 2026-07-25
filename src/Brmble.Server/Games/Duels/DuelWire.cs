using System.Text.Json;

namespace Brmble.Server.Games.Duels;

public static class DuelWire
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Status(EstimateStatus value) => value switch
    {
        EstimateStatus.Known => "known",
        EstimateStatus.Unknown => "unknown",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Method(EstimateMethod value) => value switch
    {
        EstimateMethod.FullMedian => "fullMedian",
        EstimateMethod.ConditionalRemaining => "conditionalRemaining",
        EstimateMethod.FullMedianFallback => "fullMedianFallback",
        EstimateMethod.ReadyWindow => "readyWindow",
        EstimateMethod.Insufficient => "insufficient",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Reason(DuelRejectReason value) => value switch
    {
        DuelRejectReason.None => "none",
        DuelRejectReason.Blocked => "blocked",
        DuelRejectReason.AlreadyCommitted => "alreadyCommitted",
        DuelRejectReason.NotPresent => "notPresent",
        DuelRejectReason.StaleOffer => "staleOffer",
        DuelRejectReason.NotParticipant => "notParticipant",
        DuelRejectReason.InvalidConfiguration => "invalidConfiguration",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static DuelQueueSnapshotWire ToSnapshot(DuelQueueSnapshot snapshot) =>
        DuelQueueSnapshotWire.From(snapshot, Status, Method);

    public static GameQueueSnapshotEvent ToEvent(DuelQueueSnapshot snapshot)
    {
        var wire = ToSnapshot(snapshot);
        return new GameQueueSnapshotEvent(
            "game.queueSnapshot",
            wire.SchemaVersion,
            wire.Generation,
            wire.Revision,
            wire.ChannelId,
            wire.GeneratedAt,
            wire.CalculationTimeMs,
            wire.Active,
            wire.ReadyCheck,
            wire.Queue);
    }
}

public sealed record DurationEstimateWire(
    string Status, long? Milliseconds, int SampleCount, string Method, bool Approximate);

public sealed record EtaSegmentWire(
    string GameType, string Format, int RulesetVersion, int SampleCount, string Method);

public sealed record QueueEtaWire(
    string Status,
    DateTimeOffset? EstimatedStartAt,
    long? Milliseconds,
    bool Approximate,
    IReadOnlyList<EtaSegmentWire> Segments);

public sealed record ActiveDuelWire(
    long MatchId,
    string Status,
    DateTimeOffset StartedAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimateWire Remaining);

public sealed record ReadyCheckWire(
    long ReservationId,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion);

public sealed record QueuedDuelWire(
    long ReservationId,
    int Position,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    QueueEtaWire Eta);

public sealed record DuelQueueSnapshotWire(
    int SchemaVersion,
    long Generation,
    long Revision,
    int ChannelId,
    DateTimeOffset GeneratedAt,
    long CalculationTimeMs,
    ActiveDuelWire? Active,
    ReadyCheckWire? ReadyCheck,
    IReadOnlyList<QueuedDuelWire> Queue)
{
    public static DuelQueueSnapshotWire From(
        DuelQueueSnapshot snapshot,
        Func<EstimateStatus, string> status,
        Func<EstimateMethod, string> method) =>
        new(
            snapshot.SchemaVersion,
            snapshot.Generation,
            snapshot.Revision,
            snapshot.ChannelId,
            snapshot.GeneratedAt,
            snapshot.CalculationTimeMs,
            snapshot.Active is null ? null : MapActive(snapshot.Active, status, method),
            snapshot.ReadyCheck is null ? null : MapReady(snapshot.ReadyCheck),
            snapshot.Queue.Select(x => MapQueued(x, status, method)).ToArray());

    private static ActiveDuelWire MapActive(
        ActiveDuelSnapshot active,
        Func<EstimateStatus, string> status,
        Func<EstimateMethod, string> method) =>
        new(
            active.MatchId,
            active.Status,
            active.StartedAt,
            active.Players,
            active.GameType,
            active.Format,
            active.RulesetVersion,
            new DurationEstimateWire(
                status(active.Remaining.Status),
                active.Remaining.Milliseconds,
                active.Remaining.SampleCount,
                method(active.Remaining.Method),
                active.Remaining.Approximate));

    private static ReadyCheckWire MapReady(ReadyCheckSnapshot ready) =>
        new(
            ready.ReservationId,
            ready.ExpiresAt,
            ready.Players,
            ready.GameType,
            ready.Format,
            ready.RulesetVersion);

    private static QueuedDuelWire MapQueued(
        QueuedDuelSnapshot queued,
        Func<EstimateStatus, string> status,
        Func<EstimateMethod, string> method) =>
        new(
            queued.ReservationId,
            queued.Position,
            queued.Players,
            queued.GameType,
            queued.Format,
            queued.RulesetVersion,
            new QueueEtaWire(
                status(queued.Eta.Status),
                queued.Eta.EstimatedStartAt,
                queued.Eta.Milliseconds,
                queued.Eta.Approximate,
                queued.Eta.Segments.Select(segment => new EtaSegmentWire(
                    segment.GameType,
                    segment.Format,
                    segment.RulesetVersion,
                    segment.SampleCount,
                    method(segment.Method))).ToArray()));
}

public sealed record GameQueueSnapshotEvent(
    string Type,
    int SchemaVersion,
    long Generation,
    long Revision,
    int ChannelId,
    DateTimeOffset GeneratedAt,
    long CalculationTimeMs,
    ActiveDuelWire? Active,
    ReadyCheckWire? ReadyCheck,
    IReadOnlyList<QueuedDuelWire> Queue);

public sealed record GameErrorWire(string Error, string Reason);
