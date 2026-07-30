using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Duels;

[TestClass]
public sealed class DuelDurationEstimatorTests
{
    private static readonly DateTimeOffset CalculatedAt = new(2026, 7, 25, 12, 0, 0, TimeSpan.Zero);

    [DataTestMethod]
    [DataRow(9, EstimateStatus.Unknown, EstimateMethod.Insufficient)]
    [DataRow(10, EstimateStatus.Known, EstimateMethod.FullMedian)]
    public async Task FullEstimate_RequiresTenSamples(
        int count, EstimateStatus expectedStatus, EstimateMethod expectedMethod)
    {
        var repository = new StubDurationRepository(_ => Samples(10_000, count));

        var estimate = await new DuelDurationEstimator(repository).EstimateDurationAsync(Config());

        Assert.AreEqual(expectedStatus, estimate.Status);
        Assert.AreEqual(expectedMethod, estimate.Method);
        Assert.AreEqual(count, estimate.SampleCount);
        Assert.AreEqual(expectedStatus == EstimateStatus.Known ? 10_000L : null, estimate.Milliseconds);
    }

    [DataTestMethod]
    [DataRow(new long[] { 1, 4, 9 }, 4L)]
    [DataRow(new long[] { 1, 4, 9, 20 }, 6L)]
    [DataRow(new long[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 1_000_000 }, 5L)]
    public void Median_SortsAndHandlesOddEvenAndOutlierValues(long[] values, long expected)
    {
        Assert.AreEqual(expected, DuelDurationEstimator.Median(values));
    }

    [TestMethod]
    public void Median_EmptyValuesThrowsClearArgumentException()
    {
        var error = Assert.ThrowsException<ArgumentException>(() => DuelDurationEstimator.Median([]));

        StringAssert.Contains(error.Message, "at least one value");
    }

    [TestMethod]
    public async Task FullEstimate_UsesRepositoryGroupWithoutDateFilteringOrTruncation()
    {
        var oldTimestamp = new DateTimeOffset(1999, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var supplied = Enumerable.Range(1, 101)
            .Select(index => new DurationSample(index, index * 1_000L, "completed", oldTimestamp))
            .ToArray();
        var repository = new StubDurationRepository(_ => supplied);
        var config = Config("arena", "bo7", 42);

        var estimate = await new DuelDurationEstimator(repository).EstimateDurationAsync(config);

        Assert.AreEqual(51_000L, estimate.Milliseconds);
        Assert.AreEqual(101, estimate.SampleCount);
        CollectionAssert.AreEqual(
            new[] { new RepositoryCall("arena", "bo7", 42, null) },
            repository.Calls);
    }

    [TestMethod]
    public async Task RemainingEstimate_UsesConditionalDurationMinusElapsedMedian()
    {
        var repository = new StubDurationRepository(call =>
            call.ElapsedGreaterThanMs is null ? Samples(90_000, 10) : Samples(35_000, 10));

        var estimate = await new DuelDurationEstimator(repository)
            .EstimateRemainingAsync(Config("rps", "bo3", 3), 20_000);

        Assert.AreEqual(EstimateStatus.Known, estimate.Status);
        Assert.AreEqual(15_000L, estimate.Milliseconds);
        Assert.AreEqual(10, estimate.SampleCount);
        Assert.AreEqual(EstimateMethod.ConditionalRemaining, estimate.Method);
        CollectionAssert.AreEqual(
            new[] { new RepositoryCall("rps", "bo3", 3, 20_000) },
            repository.Calls);
    }

    [TestMethod]
    public async Task RemainingEstimate_FallsBackToFullMedianAndClampsAtZero()
    {
        var repository = new StubDurationRepository(call =>
            call.ElapsedGreaterThanMs is null ? Samples(20_000, 10) : Samples(30_000, 9));

        var estimate = await new DuelDurationEstimator(repository)
            .EstimateRemainingAsync(Config(), 25_000);

        Assert.AreEqual(EstimateStatus.Known, estimate.Status);
        Assert.AreEqual(0L, estimate.Milliseconds);
        Assert.AreEqual(10, estimate.SampleCount);
        Assert.AreEqual(EstimateMethod.FullMedianFallback, estimate.Method);
    }

    [TestMethod]
    public async Task RemainingEstimate_IsUnknownWhenConditionalAndFullSamplesAreInsufficient()
    {
        var repository = new StubDurationRepository(call =>
            call.ElapsedGreaterThanMs is null ? Samples(20_000, 8) : Samples(30_000, 9));

        var estimate = await new DuelDurationEstimator(repository)
            .EstimateRemainingAsync(Config(), 5_000);

        Assert.AreEqual(EstimateStatus.Unknown, estimate.Status);
        Assert.IsNull(estimate.Milliseconds);
        Assert.AreEqual(8, estimate.SampleCount);
        Assert.AreEqual(EstimateMethod.Insufficient, estimate.Method);
    }

    [TestMethod]
    public void Combine_SumsKnownSegmentsAndUsesMinimumNonReadySampleCount()
    {
        var combined = DuelDurationEstimator.Combine([
            DurationEstimate.Known(2_000, int.MaxValue, EstimateMethod.ReadyWindow),
            DurationEstimate.Known(5_000, 14, EstimateMethod.ConditionalRemaining),
            DurationEstimate.Known(10_000, 11, EstimateMethod.FullMedian),
        ]);

        Assert.AreEqual(EstimateStatus.Known, combined.Status);
        Assert.AreEqual(17_000L, combined.Milliseconds);
        Assert.AreEqual(11, combined.SampleCount);
        Assert.AreEqual(EstimateMethod.FullMedian, combined.Method);
    }

    [TestMethod]
    public void Combine_FirstUnknownSegmentCarriesItsDiagnostics()
    {
        var combined = DuelDurationEstimator.Combine([
            DurationEstimate.Known(5_000, 12, EstimateMethod.FullMedian),
            DurationEstimate.Unknown(7),
            DurationEstimate.Unknown(4),
        ]);

        Assert.AreEqual(EstimateStatus.Unknown, combined.Status);
        Assert.IsNull(combined.Milliseconds);
        Assert.AreEqual(7, combined.SampleCount);
        Assert.AreEqual(EstimateMethod.Insufficient, combined.Method);
    }

    [TestMethod]
    public void Combine_EmptySegmentsReturnsKnownZero()
    {
        var combined = DuelDurationEstimator.Combine([]);

        Assert.AreEqual(EstimateStatus.Known, combined.Status);
        Assert.AreEqual(0L, combined.Milliseconds);
        Assert.AreEqual(0, combined.SampleCount);
        Assert.AreEqual(EstimateMethod.FullMedian, combined.Method);
    }

    [TestMethod]
    public async Task BuildEtas_ExcludesOwnDurationAndIncludesEarlierReservations()
    {
        var active = Config("rps", "bo3", 2);
        var queued = Config("arena", "1v1", 7);
        var repository = new StubDurationRepository(call => call.ElapsedGreaterThanMs is null
            ? Samples(10_000, 10)
            : Samples(call.ElapsedGreaterThanMs.Value + 5_000, 12));
        var input = Input(
            active: new ActiveSnapshotInput(active, CalculatedAt.AddSeconds(-30)),
            queue: [Reservation(1, queued), Reservation(2, queued)]);

        var etas = (await new DuelDurationEstimator(repository).BuildEtasAsync(input)).Queue.Select(entry => entry.Eta).ToArray();

        Assert.AreEqual(5_000L, etas[0].Milliseconds);
        Assert.AreEqual(CalculatedAt.AddSeconds(5), etas[0].EstimatedStartAt);
        Assert.AreEqual(15_000L, etas[1].Milliseconds);
        Assert.AreEqual(CalculatedAt.AddSeconds(15), etas[1].EstimatedStartAt);
        Assert.AreEqual(1, etas[0].Segments.Count);
        Assert.AreEqual(2, etas[1].Segments.Count);
        AssertSegment(etas[0].Segments[0], active, 12, EstimateMethod.ConditionalRemaining);
        AssertSegment(etas[1].Segments[1], queued, 10, EstimateMethod.FullMedian);
        Assert.IsTrue(etas.All(eta => eta.Approximate));
    }

    [TestMethod]
    public async Task BuildEtas_ReusesPrecomputedRemaining_AndQueriesActiveDurationExactlyOnce()
    {
        var active = Config("rps", "bo3", 2);
        var repository = new StubDurationRepository(call => IsConditionalActiveQuery(call)
            ? throw new AssertFailedException("active remaining estimate was recalculated")
            : Samples(10_000, 10));
        var input = Input(
            active: new ActiveSnapshotInput(active, CalculatedAt.AddSeconds(-30)),
            queue: [Reservation(1, Config("arena"))]);
        var remaining = DurationEstimate.Known(7_000, 14, EstimateMethod.ConditionalRemaining);

        var result = await new DuelDurationEstimator(repository).BuildEtasAsync(input, remaining);
        var eta = result.Queue.Single().Eta;

        Assert.AreEqual(7_000L, eta.Milliseconds);
        AssertSegment(eta.Segments.Single(), active, 14, EstimateMethod.ConditionalRemaining);
        Assert.AreEqual(10_000L, result.ActiveDuration!.Milliseconds);
        CollectionAssert.AreEqual(
            new[]
            {
                new RepositoryCall("arena", "bo3", 1, null),
                new RepositoryCall("rps", "bo3", 2, null),
            },
            repository.Calls);

        static bool IsConditionalActiveQuery(RepositoryCall call) =>
            call.GameType == "rps" && call.ElapsedGreaterThanMs is not null;
    }

    [TestMethod]
    public async Task BuildEtas_ReturnsReadyAndPerQueueDurationsInQueueOrder()
    {
        var ready = Config("ready", "bo3", 1);
        var first = Config("first", "bo3", 1);
        var second = Config("second", "bo3", 1);
        var repository = new StubDurationRepository(call => call.GameType switch
        {
            "ready" => Samples(11_000, 10),
            "first" => Samples(22_000, 10),
            "second" => Samples(33_000, 10),
            _ => Samples(1_000, 10),
        });
        var input = Input(
            ready: new ReadySnapshotInput(Reservation(20, ready), CalculatedAt.AddSeconds(3)),
            queue: [Reservation(1, first), Reservation(2, second)]);

        var result = await new DuelDurationEstimator(repository).BuildEtasAsync(input);

        Assert.AreEqual(11_000L, result.ReadyDuration!.Milliseconds);
        Assert.IsNull(result.ActiveDuration);
        CollectionAssert.AreEqual(
            new long?[] { 22_000L, 33_000L },
            result.Queue.Select(entry => entry.Duration.Milliseconds).ToArray());
    }

    [TestMethod]
    public async Task BuildEtas_ReadyCheckAddsWindowAndPromotedPairDuration()
    {
        var ready = Config("rps", "bo5", 4);
        var queued = Config("arena", "solo", 8);
        var input = Input(
            ready: new ReadySnapshotInput(Reservation(20, ready), CalculatedAt.AddSeconds(3)),
            queue: [Reservation(21, queued)]);

        var eta = (await new DuelDurationEstimator(
            new StubDurationRepository(_ => Samples(10_000, 15))).BuildEtasAsync(input)).Queue.Single().Eta;

        Assert.AreEqual(13_000L, eta.Milliseconds);
        Assert.AreEqual(CalculatedAt.AddSeconds(13), eta.EstimatedStartAt);
        Assert.AreEqual(2, eta.Segments.Count);
        AssertSegment(eta.Segments[0], ready, int.MaxValue, EstimateMethod.ReadyWindow);
        AssertSegment(eta.Segments[1], ready, 15, EstimateMethod.FullMedian);
    }

    [TestMethod]
    public async Task BuildEtas_UnknownEarlierDurationAffectsOnlyLaterQueueEntries()
    {
        var insufficient = Config("unknown", "1v1", 1);
        var known = Config("known", "1v1", 1);
        var repository = new StubDurationRepository(call =>
            Samples(10_000, call.GameType == "unknown" ? 9 : 10));
        var input = Input(queue: [
            Reservation(1, insufficient),
            Reservation(2, known),
            Reservation(3, known),
        ]);

        var etas = (await new DuelDurationEstimator(repository).BuildEtasAsync(input)).Queue.Select(entry => entry.Eta).ToArray();

        Assert.AreEqual(EstimateStatus.Known, etas[0].Status);
        Assert.AreEqual(0L, etas[0].Milliseconds);
        Assert.AreEqual(CalculatedAt, etas[0].EstimatedStartAt);
        Assert.AreEqual(EstimateStatus.Unknown, etas[1].Status);
        Assert.IsNull(etas[1].Milliseconds);
        Assert.IsNull(etas[1].EstimatedStartAt);
        Assert.AreEqual(EstimateStatus.Unknown, etas[2].Status);
        AssertSegment(etas[1].Segments[0], insufficient, 9, EstimateMethod.Insufficient);
    }

    [TestMethod]
    public async Task BuildEtas_CopiesSegmentsIntoImmutableSnapshots()
    {
        var input = Input(queue: [Reservation(1, Config()), Reservation(2, Config())]);

        var etas = (await new DuelDurationEstimator(
            new StubDurationRepository(_ => Samples(10_000, 10))).BuildEtasAsync(input)).Queue.Select(entry => entry.Eta).ToArray();

        Assert.AreEqual(0, etas[0].Segments.Count);
        Assert.AreEqual(1, etas[1].Segments.Count);
        var mutableView = (IList<EtaSegmentSnapshot>)etas[1].Segments;
        Assert.IsTrue(mutableView.IsReadOnly);
        Assert.ThrowsException<NotSupportedException>(() => mutableView.Add(
            new EtaSegmentSnapshot("other", "other", 1, 10, EstimateMethod.FullMedian)));
    }

    [TestMethod]
    public async Task BuildEtas_QueriesEachConfigurationGroupOnce()
    {
        var repository = new StubDurationRepository(_ => Samples(10_000, 10));
        var deathroll = Config("deathroll", "1v1", 1);
        var arena = Config("arena", "bo3", 2);
        var input = Input(queue: [
            Reservation(1, deathroll),
            Reservation(2, arena),
            Reservation(3, deathroll),
            Reservation(4, arena),
        ]);

        await new DuelDurationEstimator(repository).BuildEtasAsync(input);

        var fullQueries = repository.Calls
            .Where(call => call.ElapsedGreaterThanMs is null)
            .ToArray();
        CollectionAssert.AreEquivalent(
            new[]
            {
                new RepositoryCall("deathroll", "1v1", 1, null),
                new RepositoryCall("arena", "bo3", 2, null),
            },
            fullQueries);
    }

    private static DuelConfiguration Config(
        string gameType = "rps", string format = "bo3", int rulesetVersion = 1) =>
        new(gameType, format, rulesetVersion, new Dictionary<string, object?>(), gameType);

    private static DuelReservation Reservation(long id, DuelConfiguration configuration) =>
        new(id, 7,
            new DuelPlayer(id * 10, id * 100, $"Player {id}A"),
            new DuelPlayer(id * 10 + 1, id * 100 + 1, $"Player {id}B"),
            configuration, CalculatedAt.AddMinutes(-1), id, null);

    private static ChannelSnapshotInput Input(
        ActiveSnapshotInput? active = null,
        ReadySnapshotInput? ready = null,
        IReadOnlyList<DuelReservation>? queue = null) =>
        new(7, 2, 3, CalculatedAt, active, ready, queue ?? []);

    private static IReadOnlyList<DurationSample> Samples(long durationMs, int count) =>
        Enumerable.Range(1, count)
            .Select(index => new DurationSample(index, durationMs, "completed", CalculatedAt.AddDays(-index)))
            .ToArray();

    private static void AssertSegment(
        EtaSegmentSnapshot segment, DuelConfiguration config, int count, EstimateMethod method)
    {
        Assert.AreEqual(config.GameType, segment.GameType);
        Assert.AreEqual(config.Format, segment.Format);
        Assert.AreEqual(config.RulesetVersion, segment.RulesetVersion);
        Assert.AreEqual(count, segment.SampleCount);
        Assert.AreEqual(method, segment.Method);
    }

    private sealed record RepositoryCall(
        string GameType, string Format, int RulesetVersion, long? ElapsedGreaterThanMs);

    private sealed class StubDurationRepository(
        Func<RepositoryCall, IReadOnlyList<DurationSample>> samples) : IDurationSampleRepository
    {
        public List<RepositoryCall> Calls { get; } = [];

        public Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
            string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs)
        {
            var call = new RepositoryCall(gameType, format, rulesetVersion, elapsedGreaterThanMs);
            Calls.Add(call);
            return Task.FromResult(samples(call));
        }
    }
}
