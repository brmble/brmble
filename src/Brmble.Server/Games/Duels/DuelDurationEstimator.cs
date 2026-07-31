namespace Brmble.Server.Games.Duels;

public sealed record QueueEstimate(QueueEtaSnapshot Eta, DurationEstimate Duration);

public sealed record DuelEstimates(
    IReadOnlyList<QueueEstimate> Queue,
    DurationEstimate? ReadyDuration,
    DurationEstimate? ActiveDuration,
    DurationEstimate? ActiveRemaining = null);

public sealed class DuelDurationEstimator
{
    private const int MinimumSamples = 10;
    private readonly IDurationSampleRepository _repository;

    public DuelDurationEstimator(IDurationSampleRepository repository) => _repository = repository;

    public async Task<DurationEstimate> EstimateDurationAsync(DuelConfiguration config)
    {
        var samples = await _repository.GetDurationSamplesAsync(
            config.GameType, config.Format, config.RulesetVersion, null);

        return samples.Count >= MinimumSamples
            ? DurationEstimate.Known(
                Median(samples.Select(sample => sample.DurationMs)),
                samples.Count,
                EstimateMethod.FullMedian)
            : DurationEstimate.Unknown(samples.Count);
    }

    public Task<DurationEstimate> EstimateRemainingAsync(
        DuelConfiguration config, long elapsedMs) =>
        EstimateRemainingAsync(config, elapsedMs, EstimateDurationAsync);

    /// <summary>
    /// Conditional remaining estimate, falling back to <paramref name="fullDuration"/> minus elapsed
    /// when there are too few conditional samples. Callers that also need the full duration pass a
    /// memoized <paramref name="fullDuration"/> so the fallback and the duration share one query.
    /// </summary>
    private async Task<DurationEstimate> EstimateRemainingAsync(
        DuelConfiguration config,
        long elapsedMs,
        Func<DuelConfiguration, Task<DurationEstimate>> fullDuration)
    {
        var conditional = await _repository.GetDurationSamplesAsync(
            config.GameType, config.Format, config.RulesetVersion, elapsedMs);
        if (conditional.Count >= MinimumSamples)
        {
            return DurationEstimate.Known(
                Median(conditional.Select(sample => checked(sample.DurationMs - elapsedMs))),
                conditional.Count,
                EstimateMethod.ConditionalRemaining);
        }

        var full = await fullDuration(config);
        if (full.Status == EstimateStatus.Unknown)
            return full;

        return DurationEstimate.Known(
            Math.Max(0, checked(full.Milliseconds!.Value - elapsedMs)),
            full.SampleCount,
            EstimateMethod.FullMedianFallback);
    }

    internal static long Median(IEnumerable<long> values)
    {
        var ordered = values.Order().ToArray();
        if (ordered.Length == 0)
            throw new ArgumentException("Median requires at least one value.", nameof(values));

        var middle = ordered.Length / 2;
        return ordered.Length % 2 == 1
            ? ordered[middle]
            : checked(ordered[middle - 1] + ordered[middle]) / 2;
    }

    public static DurationEstimate Combine(IReadOnlyList<DurationEstimate> segments)
    {
        var unknown = segments.FirstOrDefault(segment => segment.Status == EstimateStatus.Unknown);
        if (unknown is not null)
            return DurationEstimate.Unknown(unknown.SampleCount);

        long milliseconds = 0;
        foreach (var segment in segments)
            milliseconds = checked(milliseconds + segment.Milliseconds!.Value);

        var sampleCount = segments
            .Where(segment => segment.Method != EstimateMethod.ReadyWindow)
            .Select(segment => segment.SampleCount)
            .DefaultIfEmpty(0)
            .Min();

        return DurationEstimate.Known(milliseconds, sampleCount, EstimateMethod.FullMedian);
    }

    public async Task<DuelEstimates> BuildEtasAsync(ChannelSnapshotInput input)
    {
        var cache = new Dictionary<(string GameType, string Format, int RulesetVersion), DurationEstimate>();
        var accumulated = new List<DurationEstimate>();
        var segments = new List<EtaSegmentSnapshot>();
        DurationEstimate? readyDuration = null;
        DurationEstimate? activeRemaining = null;

        if (input.Active is not null)
        {
            var elapsedMs = Math.Max(
                0,
                checked((long)(input.CalculatedAt - input.Active.StartedAt).TotalMilliseconds));
            activeRemaining = input.Active.Status == "starting"
                ? await Duration(input.Active.Configuration)
                : await EstimateRemainingAsync(input.Active.Configuration, elapsedMs, Duration);
            Add(activeRemaining, input.Active.Configuration);
        }

        if (input.ReadyCheck is not null)
        {
            var readyWindowMs = Math.Max(
                0,
                checked((long)(input.ReadyCheck.ExpiresAt - input.CalculatedAt).TotalMilliseconds));
            Add(
                DurationEstimate.Known(readyWindowMs, int.MaxValue, EstimateMethod.ReadyWindow),
                input.ReadyCheck.Reservation.Configuration);
            readyDuration = await Duration(input.ReadyCheck.Reservation.Configuration);
            Add(readyDuration, input.ReadyCheck.Reservation.Configuration);
        }

        var result = new List<QueueEstimate>(input.Queue.Count);
        foreach (var reservation in input.Queue)
        {
            var combined = Combine(accumulated);
            var eta = new QueueEtaSnapshot(
                combined.Status,
                combined.Status == EstimateStatus.Known
                    ? input.CalculatedAt.AddMilliseconds(combined.Milliseconds!.Value)
                    : null,
                combined.Milliseconds,
                true,
                segments.ToArray());

            var queueDuration = await Duration(reservation.Configuration);
            result.Add(new QueueEstimate(eta, queueDuration));
            Add(queueDuration, reservation.Configuration);
        }

        // Computed after the loop purely so the memo cache is already warm; `Duration`
        // is order-independent, so this does not affect the value. When the active
        // remaining estimate already needed the full duration (a `starting` duel, or a
        // fallback from too few conditional samples) this is a cache hit.
        var activeDuration = input.Active is null
            ? null
            : await Duration(input.Active.Configuration);

        return new DuelEstimates(result, readyDuration, activeDuration, activeRemaining);

        async Task<DurationEstimate> Duration(DuelConfiguration config)
        {
            var key = (config.GameType, config.Format, config.RulesetVersion);
            if (cache.TryGetValue(key, out var cached)) return cached;
            var estimate = await EstimateDurationAsync(config);
            cache[key] = estimate;
            return estimate;
        }

        void Add(DurationEstimate estimate, DuelConfiguration config)
        {
            accumulated.Add(estimate);
            segments.Add(new EtaSegmentSnapshot(
                config.GameType,
                config.Format,
                config.RulesetVersion,
                estimate.SampleCount,
                estimate.Method));
        }
    }
}
