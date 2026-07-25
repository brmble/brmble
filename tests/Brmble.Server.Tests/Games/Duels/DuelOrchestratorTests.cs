using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Reflection;

namespace Brmble.Server.Tests.Games.Duels;

internal sealed class TestDefinition : IDuelGameDefinition
{
    public string GameType => "test";
    public string RunnerKey => "test-runner";
    public int RulesetVersion => 4;

    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
    {
        var value = options is not null && options.TryGetValue("limit", out var raw)
            ? Convert.ToInt32(raw)
            : 10;
        if (value < 1) throw new InvalidGameConfigurationException("limit must be positive");
        return new Dictionary<string, object?> { ["limit"] = value };
    }

    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) =>
        $"limit-{normalizedOptions["limit"]}";
}

internal sealed class TestRpsDefinition : IDuelGameDefinition
{
    public string GameType => "rps";
    public string RunnerKey => "test-runner";
    public int RulesetVersion => 4;
    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options) =>
        new Dictionary<string, object?> { ["bestOf"] = Convert.ToInt32(options?["bestOf"] ?? 3) };
    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) =>
        $"bo{normalizedOptions["bestOf"]}";
}

internal sealed class TestPresence : IGamePresence
{
    public Dictionary<long, (int Channel, bool Brmble, long UserId, string Name)> Sessions { get; } = [];
    public HashSet<long> Blocked { get; } = [];

    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        if (Sessions.TryGetValue(sessionId, out var value))
        {
            (channelId, isBrmble, userId) = (value.Channel, value.Brmble, value.UserId);
            return true;
        }
        channelId = 0;
        isBrmble = false;
        userId = 0;
        return false;
    }

    public string? GetDisplayName(long sessionId) =>
        Sessions.TryGetValue(sessionId, out var value) ? value.Name : null;

    public Task<bool> AreChallengesBlockedAsync(long sessionId) =>
        Task.FromResult(Blocked.Contains(sessionId));
}

internal sealed class TestPublisher : IGameEventPublisher
{
    public List<(IReadOnlySet<long> Users, object Message)> UserMessages { get; } = [];
    public List<(int ChannelId, object Message)> ChannelMessages { get; } = [];
    public string? FailType { get; set; }
    public string? BlockType { get; set; }
    public TaskCompletionSource Blocked { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public object? BlockedMessage { get; private set; }
    public Func<object, Task>? BeforeReturn { get; set; }
    public bool BlockChannelSnapshots { get; set; }
    public int FailChannelPublications { get; set; }
    public int ChannelPublicationAttempts { get; private set; }
    public TaskCompletionSource ReleaseChannelSnapshots { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        var type = message.GetType().GetProperty("type")?.GetValue(message) as string;
        if (type == BlockType) { BlockedMessage = message; Blocked.TrySetResult(); await Release.Task; }
        lock (UserMessages) UserMessages.Add((userIds, message));
        if (type == FailType)
            throw new InvalidOperationException("publication failed");
        if (BeforeReturn is { } callback)
            await callback(message);
    }
    public async Task PublishToChannelAsync(int channelId, object message)
    {
        ChannelPublicationAttempts++;
        if (FailChannelPublications-- > 0) throw new InvalidOperationException("channel publication failed");
        if (BlockChannelSnapshots) await ReleaseChannelSnapshots.Task;
        lock (ChannelMessages) ChannelMessages.Add((channelId, message));
    }
}

internal sealed class TestDurationRepository : IDurationSampleRepository
{
    public Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs) =>
        Task.FromResult<IReadOnlyList<DurationSample>>(Enumerable.Range(1, 10)
            .Select(i => new DurationSample(i, 60_000, "complete", DateTimeOffset.UtcNow))
            .Where(x => elapsedGreaterThanMs is null || x.DurationMs > elapsedGreaterThanMs)
            .ToArray());
}

internal sealed class BlockingDurationRepository : IDurationSampleRepository
{
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public int Calls { get; private set; }

    public async Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs)
    {
        Calls++;
        Entered.TrySetResult();
        await Release.Task;
        return Enumerable.Range(1, 10)
            .Select(i => new DurationSample(i, 60_000, "complete", DateTimeOffset.UtcNow))
            .ToArray();
    }
}

internal sealed class FailOnceDurationRepository : IDurationSampleRepository
{
    private int _calls;
    public TaskCompletionSource Failed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs)
    {
        if (Interlocked.Increment(ref _calls) == 1)
        {
            Failed.TrySetResult();
            throw new InvalidOperationException("estimation failed");
        }
        return Task.FromResult<IReadOnlyList<DurationSample>>(Enumerable.Range(1, 10)
            .Select(i => new DurationSample(i, 60_000, "complete", DateTimeOffset.UtcNow))
            .ToArray());
    }
}

internal sealed class TestRouter : IDuelMatchRunnerRouter
{
    private long _matchId;
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public List<DuelReservation> Starts { get; } = [];
    public TaskCompletionSource? StartBlock { get; set; }
    public bool FailNextStart { get; set; }
    public bool CompleteDuringStart { get; set; }
    public Func<Task>? AfterCompletionDuringStart { get; set; }
    public Dictionary<long, ActiveMatchReference> ActiveMatches { get; } = [];
    public List<(long MatchId, long UserId, string Reason)> Forfeits { get; } = [];
    public List<(long MatchId, long UserId, string Reason)> ForfeitAttempts { get; } = [];
    public TaskCompletionSource? ForfeitBlock { get; set; }
    public TaskCompletionSource ForfeitEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public bool FailNextForfeit { get; set; }

    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        lock (Starts) Starts.Add(reservation);
        if (StartBlock is not null) await StartBlock.Task;
        if (FailNextStart)
        {
            FailNextStart = false;
            return new(false, 0, null, "start failed");
        }
        var matchId = Interlocked.Increment(ref _matchId);
        if (CompleteDuringStart)
        {
            CompleteDuringStart = false;
            await CompleteAsync(new MatchCompletion(
                matchId, reservation.ReservationId, reservation.ChannelId,
                reservation.PlayerOne, reservation.PlayerTwo, reservation.Configuration,
                DateTimeOffset.UtcNow));
            if (AfterCompletionDuringStart is not null) await AfterCompletionDuringStart();
        }
        return new(true, matchId, DateTimeOffset.UtcNow, null);
    }

    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match) =>
        ActiveMatches.TryGetValue(userId, out match!);
    public async Task ForfeitAsync(long matchId, long userId, string reason)
    {
        lock (ForfeitAttempts) ForfeitAttempts.Add((matchId, userId, reason));
        ForfeitEntered.TrySetResult();
        if (ForfeitBlock is not null) await ForfeitBlock.Task;
        if (FailNextForfeit)
        {
            FailNextForfeit = false;
            throw new InvalidOperationException("forfeit failed");
        }
        Forfeits.Add((matchId, userId, reason));
    }
    public Task CompleteAsync(MatchCompletion completion) => MatchCompleted?.Invoke(completion) ?? Task.CompletedTask;
}

internal sealed class TestTimeProvider(DateTimeOffset start) : TimeProvider
{
    private readonly List<TestTimer> _timers = [];
    private DateTimeOffset _now = start;
    public override DateTimeOffset GetUtcNow() => _now;
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new TestTimer(this, callback, state, _now + dueTime);
        _timers.Add(timer);
        return timer;
    }
    public void Advance(TimeSpan by)
    {
        _now += by;
        foreach (var timer in _timers.ToArray()) timer.FireIfDue(_now);
    }
    public void FireTimerEvenIfDisposed(int index) => _timers[index].FireEvenIfDisposed();
    public bool IsTimerDisposed(int index) => _timers[index].IsDisposed;
    public int TimerCount => _timers.Count;
    private sealed class TestTimer(TestTimeProvider owner, TimerCallback callback, object? state, DateTimeOffset due) : ITimer
    {
        private bool _disposed;
        private DateTimeOffset _due = due;
        public bool IsDisposed => _disposed;
        public bool Change(TimeSpan dueTime, TimeSpan period) { _due = owner._now + dueTime; return !_disposed; }
        public void Dispose() => _disposed = true;
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        public void FireIfDue(DateTimeOffset now)
        {
            if (_disposed || now < _due) return;
            _disposed = true;
            callback(state);
        }
        public void FireEvenIfDisposed() => callback(state);
    }
}

[TestClass]
public class DuelOrchestratorTests
{
    private static (DuelOrchestrator Orchestrator, TestPresence Presence, TestPublisher Publisher, TestRouter Router) Create()
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var catalog = new GameDefinitionCatalog([new TestDefinition()]);
        return (new DuelOrchestrator(catalog, presence, publisher, router,
            new DuelDurationEstimator(new TestDurationRepository())), presence, publisher, router);
    }

    private static (DuelOrchestrator Orchestrator, TestPresence Presence, TestPublisher Publisher, TestRouter Router) Create(TimeProvider timeProvider)
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var catalog = new GameDefinitionCatalog([new TestDefinition()]);
        return (new DuelOrchestrator(catalog, presence, publisher, router,
            new DuelDurationEstimator(new TestDurationRepository()), timeProvider), presence, publisher, router);
    }

    private static void Add(TestPresence presence, long session, long user, int channel = 1) =>
        presence.Sessions[session] = (channel, true, user, $"user-{user}");

    [TestMethod]
    public async Task RunnerBlocked_RecoverySnapshotShowsStartingThenLive()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var acceptance = sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        var starting = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual("starting", starting.Active?.Status);
        Assert.AreEqual(0L, starting.Active?.MatchId);
        Assert.AreEqual(router.Starts[0].AcceptedAt, starting.Active?.StartedAt);
        Assert.AreEqual(EstimateMethod.FullMedian, starting.Active?.Remaining.Method);

        router.StartBlock.TrySetResult();
        await acceptance;
        var live = await sut.GetSnapshotForSessionAsync(10);
        Assert.AreEqual("live", live.Active?.Status);
        Assert.IsTrue(live.Active?.MatchId > 0);
        Assert.IsTrue(live.Revision > starting.Revision);
    }

    [TestMethod]
    public async Task MutationBurst_CoalescesBlockedCalculationToInitialAndLatest()
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter { StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var durations = new BlockingDurationRepository();
        var sut = new DuelOrchestrator(new GameDefinitionCatalog([new TestDefinition()]),
            presence, publisher, router, new DuelDurationEstimator(durations));
        for (var i = 1; i <= 8; i++) Add(presence, i * 10, i * 100);
        var offers = new List<DuelCommandResult>();
        for (var i = 0; i < 4; i++)
            offers.Add(await sut.CreateChallengeAsync(i * 20 + 10, i * 20 + 20, "test", null));

        var starting = sut.RespondToOfferAsync(offers[0].OfferId!.Value, 200, true);
        await durations.Entered.Task;
        for (var i = 1; i < offers.Count; i++)
            await sut.RespondToOfferAsync(offers[i].OfferId!.Value, (i * 2 + 2) * 100, true);
        durations.Release.TrySetResult();
        await sut.DrainSnapshotPublicationsAsync(1);

        Assert.IsTrue(durations.Calls <= 5, $"Expected bounded calculations, got {durations.Calls} repository calls.");
        var snapshots = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>().ToArray();
        Assert.AreEqual(2, snapshots.Length);
        Assert.AreEqual(4L, snapshots[^1].Revision);
        Assert.AreEqual(3, snapshots[^1].Queue.Count);
        Assert.IsFalse(sut.HasActiveSnapshotWorker(1));
        router.StartBlock.TrySetResult();
        await starting;
    }

    [TestMethod]
    public async Task FailedSnapshotPublication_RetriesCurrentLatestAfterFakeDelay()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var (sut, presence, publisher, _) = Create(clock);
        Add(presence, 10, 100); Add(presence, 20, 200);
        publisher.FailChannelPublications = 1;
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => publisher.ChannelPublicationAttempts == 1);
        await WaitUntilAsync(() => sut.IsSnapshotRetryWaiting(1));

        Assert.IsFalse(sut.DrainSnapshotPublicationsAsync(1).IsCompleted);
        clock.Advance(TimeSpan.FromSeconds(1));
        await sut.DrainSnapshotPublicationsAsync(1);

        Assert.AreEqual(2, publisher.ChannelPublicationAttempts);
        Assert.AreEqual(2L, publisher.ChannelMessages.Select(x => x.Message)
            .OfType<GameQueueSnapshotEvent>().Last().Revision);
    }

    [TestMethod]
    public async Task FailedSnapshotCalculation_CoalescesMutationDuringRetryDelay()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var repository = new FailOnceDurationRepository();
        var sut = new DuelOrchestrator(new GameDefinitionCatalog([new TestDefinition()]),
            presence, publisher, router, new DuelDurationEstimator(repository), clock);
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var first = await sut.CreateChallengeAsync(10, 20, "test", null);
        var second = await sut.CreateChallengeAsync(30, 40, "test", null);
        await sut.RespondToOfferAsync(first.OfferId!.Value, 200, true);
        await repository.Failed.Task;
        await WaitUntilAsync(() => sut.IsSnapshotRetryWaiting(1));
        await sut.RespondToOfferAsync(second.OfferId!.Value, 400, true);

        clock.Advance(TimeSpan.FromSeconds(1));
        await sut.DrainSnapshotPublicationsAsync(1);

        var snapshot = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>().Single();
        Assert.AreEqual(3L, snapshot.Revision);
        Assert.AreEqual(1, snapshot.Queue.Count);
    }

    [TestMethod]
    public async Task IdleAcceptance_StartsRunnerWhileSnapshotEstimationIsBlocked()
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var durations = new BlockingDurationRepository();
        var sut = new DuelOrchestrator(new GameDefinitionCatalog([new TestDefinition()]),
            presence, publisher, router, new DuelDurationEstimator(durations));
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var acceptance = sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);

        await WaitUntilAsync(() => router.Starts.Count == 1);
        Assert.IsTrue(acceptance.IsCompletedSuccessfully);
        Assert.IsFalse(sut.DrainSnapshotPublicationsAsync(1).IsCompleted);
        durations.Release.TrySetResult();
        await sut.DrainSnapshotPublicationsAsync(1);
        Assert.IsTrue(publisher.ChannelMessages.Select(x => x.Message)
            .OfType<GameQueueSnapshotEvent>().Any(x => x.Active is not null));
    }

    [TestMethod]
    public async Task FinalReadyAcceptance_StartsRunnerWhileSnapshotPublicationIsBlocked()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var waitingOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var waiting = await sut.RespondToOfferAsync(waitingOffer.OfferId!.Value, 400, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.DrainSnapshotPublicationsAsync(1);
        await sut.RespondReadyAsync(waiting.ReservationId!.Value, 300, ReadyResponse.Accept);
        await sut.DrainSnapshotPublicationsAsync(1);
        publisher.BlockChannelSnapshots = true;

        var acceptance = sut.RespondReadyAsync(waiting.ReservationId.Value, 400, ReadyResponse.Accept);

        await WaitUntilAsync(() => router.Starts.Count == 2);
        Assert.IsTrue(acceptance.IsCompletedSuccessfully);
        publisher.ReleaseChannelSnapshots.TrySetResult();
        await sut.DrainSnapshotPublicationsAsync(1);
        var revisions = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>()
            .Select(x => x.Revision).ToArray();
        Assert.IsTrue(revisions.Zip(revisions.Skip(1)).All(x => x.First < x.Second));
    }

    [TestMethod]
    public async Task ConcurrentMutations_PublishLatestRevisionAfterPrivatePublicationCompletes()
    {
        var (sut, presence, publisher, _) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var firstOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var secondOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        publisher.BlockType = "game.accepted";

        var first = sut.RespondToOfferAsync(firstOffer.OfferId!.Value, 200, true);
        await publisher.Blocked.Task;
        publisher.BlockType = null;
        await sut.RespondToOfferAsync(secondOffer.OfferId!.Value, 400, true);
        publisher.Release.TrySetResult();
        await first;
        await sut.DrainSnapshotPublicationsAsync(1);

        var revisions = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>()
            .Select(x => x.Revision).ToArray();
        Assert.IsTrue(revisions.Zip(revisions.Skip(1)).All(x => x.First < x.Second));
        Assert.AreEqual(3L, revisions[^1]);
    }

    [TestMethod]
    public async Task AcceptedAndCompletedMatch_PublishesCompleteMonotonicSnapshotsIncludingFinalEmpty()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var accepted = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await router.CompleteAsync(new MatchCompletion(1, accepted.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.DrainSnapshotPublicationsAsync(1);

        var snapshots = publisher.ChannelMessages.Select(x => x.Message)
            .OfType<GameQueueSnapshotEvent>().ToArray();
        Assert.IsTrue(snapshots.Length >= 1);
        Assert.IsTrue(snapshots.Zip(snapshots.Skip(1)).All(x => x.First.Revision < x.Second.Revision));
        Assert.IsNull(snapshots[^1].Active);
        Assert.IsNull(snapshots[^1].ReadyCheck);
        Assert.AreEqual(0, snapshots[^1].Queue.Count);
    }

    [TestMethod]
    public async Task QueueSnapshot_MapsOrderedPlayersEtasAndDoesNotPublishPrivateOffers()
    {
        var (sut, presence, publisher, _) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        Assert.AreEqual(0, publisher.ChannelMessages.Count);
        await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var queuedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 400, true);

        var snapshot = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual(1, snapshot.Queue.Count);
        Assert.AreEqual(1, snapshot.Queue[0].Position);
        CollectionAssert.AreEqual(new long[] { 300, 400 }, snapshot.Queue[0].Players.Select(x => x.UserId).ToArray());
        Assert.AreEqual(EstimateStatus.Known, snapshot.Queue[0].Eta.Status);
        Assert.AreEqual(EstimateMethod.ConditionalRemaining, snapshot.Queue[0].Eta.Segments[0].Method);
        Assert.IsNotNull(snapshot.Active);
        Assert.AreEqual(EstimateStatus.Known, snapshot.Active.Remaining.Status);
        Assert.IsTrue(snapshot.CalculationTimeMs >= 0);
    }

    [TestMethod]
    public async Task ChannelRemoval_PublishesHigherGenerationEmptySnapshot()
    {
        var (sut, presence, publisher, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await sut.DrainSnapshotPublicationsAsync(1);
        var before = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>().Last();

        await sut.HandleChannelRemovedAsync(1);
        await sut.DrainSnapshotPublicationsAsync(1);

        var removed = publisher.ChannelMessages.Select(x => x.Message).OfType<GameQueueSnapshotEvent>().Last();
        Assert.IsTrue(removed.Generation > before.Generation);
        Assert.IsTrue(removed.Revision > before.Revision);
        Assert.IsNull(removed.Active);
        Assert.AreEqual(0, removed.Queue.Count);
    }

    [TestMethod]
    public async Task UnknownSession_ReturnsStableNeverSeenEmptySnapshot()
    {
        var (sut, _, _, _) = Create();

        var snapshot = await sut.GetSnapshotForSessionAsync(999);

        Assert.AreEqual(0, snapshot.ChannelId);
        Assert.AreEqual(0L, snapshot.Generation);
        Assert.AreEqual(0L, snapshot.Revision);
        Assert.AreEqual(0, snapshot.Queue.Count);
    }

    [TestMethod]
    public async Task PresentChannelSnapshot_ReadDoesNotCreateClockAndFirstAcceptedMutationStartsAtOne()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);

        var first = await sut.GetSnapshotForSessionAsync(10);
        var second = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual(0L, first.Generation);
        Assert.AreEqual(0L, first.Revision);
        Assert.AreEqual(0L, second.Generation);
        Assert.AreEqual(0L, second.Revision);

        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var acceptance = sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        var mutated = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual(1L, mutated.Generation);
        Assert.AreEqual(1L, mutated.Revision);
        router.StartBlock.SetResult();
        await acceptance;
    }

    [TestMethod]
    public async Task ConcurrentChallengesAcrossSessionsOfSameUser_CommitExactlyOnce()
    {
        var (sut, presence, _, _) = Create();
        Add(presence, 10, 100); Add(presence, 11, 100); Add(presence, 20, 200); Add(presence, 30, 300);

        var results = await Task.WhenAll(
            sut.CreateChallengeAsync(10, 20, "test", null),
            sut.CreateChallengeAsync(11, 30, "test", null));

        Assert.AreEqual(1, results.Count(x => x.Success));
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, results.Single(x => !x.Success).Reason);
        var winnerTarget = results[0].Success ? 200 : 300;
        var blocked = await sut.CreateChallengeAsync(11, winnerTarget == 200 ? 30 : 20, "test", null);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, blocked.Reason);
    }

    [TestMethod]
    public async Task InvalidConfiguration_DoesNotCommitPlayers()
    {
        var (sut, presence, _, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);

        var invalid = await sut.CreateChallengeAsync(10, 20, "test",
            new Dictionary<string, object?> { ["limit"] = 0 });
        var valid = await sut.CreateChallengeAsync(10, 20, "test", null);

        Assert.IsFalse(invalid.Success);
        Assert.AreEqual(DuelRejectReason.InvalidConfiguration, invalid.Reason);
        Assert.AreEqual("limit must be positive", invalid.Error);
        Assert.IsTrue(valid.Success);
    }

    [TestMethod]
    public async Task Challenge_ValidatesPresenceChannelIdentityAndBlocking()
    {
        var (sut, presence, _, _) = Create();
        Add(presence, 10, 100, 1); Add(presence, 11, 100, 1); Add(presence, 20, 200, 2);

        Assert.AreEqual(DuelRejectReason.NotPresent,
            (await sut.CreateChallengeAsync(10, 99, "test", null)).Reason);
        Assert.AreEqual(DuelRejectReason.NotPresent,
            (await sut.CreateChallengeAsync(10, 11, "test", null)).Reason);
        Assert.AreEqual(DuelRejectReason.NotPresent,
            (await sut.CreateChallengeAsync(10, 20, "test", null)).Reason);

        presence.Sessions[20] = (1, true, 200, "user-200");
        presence.Blocked.Add(20);
        Assert.AreEqual(DuelRejectReason.Blocked,
            (await sut.CreateChallengeAsync(10, 20, "test", null)).Reason);
    }

    [TestMethod]
    public async Task AcceptOnIdleChannel_StartsCanonicalReservationAndMarksPairActiveWhileAwaitingRunner()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        var offer = await sut.CreateChallengeAsync(10, 20, "test",
            new Dictionary<string, object?> { ["limit"] = 7L });
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);

        var acceptance = sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        var blocked = await sut.CreateChallengeAsync(10, 30, "test", null);
        router.StartBlock.SetResult();
        var accepted = await acceptance;

        Assert.IsTrue(accepted.Success);
        Assert.AreNotEqual(offer.OfferId, accepted.ReservationId);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, blocked.Reason);
        Assert.AreEqual(7, router.Starts.Single().Configuration.Options["limit"]);
        Assert.AreEqual(offer.OfferId, accepted.OfferId);
    }

    [TestMethod]
    public async Task AcceptedPairsQueueByAcceptanceOrderAndChannelsAreIndependent()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 8; i++) Add(presence, i * 10, i * 100, i > 6 ? 2 : 1);
        var first = await sut.CreateChallengeAsync(10, 20, "test", null);
        var createdSecond = await sut.CreateChallengeAsync(30, 40, "test", null);
        var createdThird = await sut.CreateChallengeAsync(50, 60, "test", null);
        var otherChannel = await sut.CreateChallengeAsync(70, 80, "test", null);

        await sut.RespondToOfferAsync(first.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(createdThird.OfferId!.Value, 600, true);
        await sut.RespondToOfferAsync(createdSecond.OfferId!.Value, 400, true);
        await sut.RespondToOfferAsync(otherChannel.OfferId!.Value, 800, true);

        Assert.AreEqual(2, router.Starts.Count);
        Assert.AreEqual(100L, router.Starts[0].PlayerOne.UserId);
        Assert.AreEqual(700L, router.Starts[1].PlayerOne.UserId);
        var snapshot = await sut.GetSnapshotForSessionAsync(10);
        CollectionAssert.AreEqual(new long[] { 500, 300 }, snapshot.Queue.Select(x => x.Players[0].UserId).ToArray());
    }

    [TestMethod]
    public async Task ConcurrentAcceptance_StartsExactlyOnce_AndDuplicateIsStale()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var results = await Task.WhenAll(
            sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true),
            sut.RespondToOfferAsync(offer.OfferId.Value, 200, true));

        Assert.AreEqual(1, results.Count(x => x.Success));
        Assert.AreEqual(DuelRejectReason.StaleOffer, results.Single(x => !x.Success).Reason);
        Assert.AreEqual(1, router.Starts.Count);
    }

    [TestMethod]
    public async Task AcceptedPublicationFailure_DoesNotControlAuthoritativeStart()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        publisher.FailType = "game.accepted";

        var result = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);

        Assert.IsTrue(result.Success);
        Assert.AreEqual(1, router.Starts.Count);
    }

    [TestMethod]
    public async Task StartFailure_ReleasesCommitmentsAndDoesNotLeaveChannelAdvancing()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        router.FailNextStart = true;
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var result = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        var replacement = await sut.CreateChallengeAsync(10, 30, "test", null);

        Assert.IsFalse(result.Success);
        Assert.IsTrue(replacement.Success);
        Assert.IsTrue(publisher.UserMessages.Any(x =>
            x.Message.GetType().GetProperty("reason")?.GetValue(x.Message) as string == "startFailed"));
    }

    [TestMethod]
    public async Task StartFailure_PreservesQueuedPairForReadyCheckAdvancement()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300); Add(presence, 40, 400);
        Add(presence, 50, 500); Add(presence, 60, 600);
        var first = await sut.CreateChallengeAsync(10, 20, "test", null);
        var second = await sut.CreateChallengeAsync(30, 40, "test", null);
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstAcceptance = sut.RespondToOfferAsync(first.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        await sut.RespondToOfferAsync(second.OfferId!.Value, 400, true);
        router.FailNextStart = true;
        router.StartBlock.SetResult();
        await firstAcceptance;
        var third = await sut.CreateChallengeAsync(50, 60, "test", null);
        await sut.RespondToOfferAsync(third.OfferId!.Value, 600, true);
        var snapshot = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(300L, snapshot.ReadyCheck?.Players[0].UserId);
        CollectionAssert.AreEqual(new long[] { 500 },
            snapshot.Queue.Select(x => x.Players[0].UserId).ToArray());
    }

    [TestMethod]
    public async Task StartFailurePublicationFailure_StillPreservesQueuedProgressionState()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var first = await sut.CreateChallengeAsync(10, 20, "test", null);
        var second = await sut.CreateChallengeAsync(30, 40, "test", null);
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstAcceptance = sut.RespondToOfferAsync(first.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        await sut.RespondToOfferAsync(second.OfferId!.Value, 400, true);
        publisher.FailType = "game.commitmentCanceled";
        router.FailNextStart = true;

        router.StartBlock.SetResult();
        var failed = await firstAcceptance;
        var third = await sut.CreateChallengeAsync(50, 60, "test", null);
        await sut.RespondToOfferAsync(third.OfferId!.Value, 600, true);

        Assert.IsFalse(failed.Success);
        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(300L, (await sut.GetSnapshotForSessionAsync(10)).ReadyCheck?.Players[0].UserId);
        CollectionAssert.AreEqual(new long[] { 500 },
            (await sut.GetSnapshotForSessionAsync(10)).Queue.Select(x => x.Players[0].UserId).ToArray());
    }

    [TestMethod]
    public async Task CompletionWithQueuedPair_KeepsQueueOccupiedAndAppendsNewAcceptance()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var queuedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var newcomerOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 400, true);

        await router.CompleteAsync(new MatchCompletion(
            1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.RespondToOfferAsync(newcomerOffer.OfferId!.Value, 600, true);
        var snapshot = await sut.GetSnapshotForSessionAsync(10);

        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(queuedOffer.OfferId.HasValue, snapshot.ReadyCheck is not null);
        Assert.AreEqual(300L, snapshot.ReadyCheck?.Players[0].UserId);
        CollectionAssert.AreEqual(new long[] { 500 },
            snapshot.Queue.Select(x => x.Players[0].UserId).ToArray());
    }

    [TestMethod]
    public async Task Completion_PromotesFirstPairAndBothPlayersMustAcceptBeforeStart()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var firstOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var queuedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var first = await sut.RespondToOfferAsync(firstOffer.OfferId!.Value, 200, true);
        var queued = await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 400, true);

        var before = DateTimeOffset.UtcNow;
        await router.CompleteAsync(new MatchCompletion(
            1, first.ReservationId!.Value, 1, router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        var promoted = await sut.GetSnapshotForSessionAsync(30);

        Assert.AreEqual(queued.ReservationId, promoted.ReadyCheck?.ReservationId);
        Assert.IsTrue(promoted.ReadyCheck?.ExpiresAt >= before.AddSeconds(14));
        Assert.IsTrue(promoted.ReadyCheck?.ExpiresAt <= DateTimeOffset.UtcNow.AddSeconds(16));
        Assert.IsTrue((await sut.RespondReadyAsync(queued.ReservationId!.Value, 300, ReadyResponse.Accept)).Success);
        Assert.AreEqual(1, router.Starts.Count);
        Assert.IsTrue((await sut.GetSnapshotForSessionAsync(30)).ReadyCheck?.Players.Single(x => x.UserId == 300).Ready);
        Assert.IsTrue((await sut.RespondReadyAsync(queued.ReservationId.Value, 400, ReadyResponse.Accept)).Success);
        Assert.AreEqual(2, router.Starts.Count);
    }

    [TestMethod]
    public async Task FinalReadyAcceptance_RevalidatesBothPlayersAndPromotesNextWithoutStarting()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var readyOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var ready = await sut.RespondToOfferAsync(readyOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.RespondReadyAsync(ready.ReservationId!.Value, 300, ReadyResponse.Accept);
        presence.Sessions.Remove(30);

        var result = await sut.RespondReadyAsync(ready.ReservationId.Value, 400, ReadyResponse.Accept);

        Assert.IsFalse(result.Success);
        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
        Add(presence, 30, 300);
        Assert.IsTrue((await sut.CreateChallengeAsync(30, 40, "test", null)).Success);
    }

    [TestMethod]
    public async Task DisconnectDuringFinalReadyPublication_PreventsRunnerStartAndAdvances()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var readyOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var ready = await sut.RespondToOfferAsync(readyOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.RespondReadyAsync(ready.ReservationId!.Value, 300, ReadyResponse.Accept);
        publisher.BlockType = "game.readyCheck";

        var finalAccept = sut.RespondReadyAsync(ready.ReservationId.Value, 400, ReadyResponse.Accept);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var cleanup = sut.HandlePresenceLostAsync(300, 30, DuelCancelReason.Disconnected);
        await WaitUntilAsync(() => sut.GetSnapshotForSessionAsync(50).Result.ReadyCheck?.ReservationId == next.ReservationId);
        publisher.Release.TrySetResult();
        await cleanup;
        var result = await finalAccept;

        Assert.IsFalse(result.Success);
        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
    }

    [TestMethod]
    public async Task PresenceChangeDuringFinalReadyPublication_PrecheckCancelsAndAdvances()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var readyOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var ready = await sut.RespondToOfferAsync(readyOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.RespondReadyAsync(ready.ReservationId!.Value, 300, ReadyResponse.Accept);
        publisher.BlockType = "game.readyCheck";

        var finalAccept = sut.RespondReadyAsync(ready.ReservationId.Value, 400, ReadyResponse.Accept);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        presence.Sessions.Remove(30);
        publisher.Release.TrySetResult();
        var result = await finalAccept;

        Assert.IsFalse(result.Success);
        Assert.AreEqual(1, router.Starts.Count);
        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
    }

    [TestMethod]
    public async Task ChannelRemovalDuringRunnerStart_CompensatesSuccessfulStaleMatchOnce()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var acceptance = sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        await sut.HandleChannelRemovedAsync(1);
        router.StartBlock.SetResult();
        var result = await acceptance;

        Assert.IsFalse(result.Success);
        CollectionAssert.AreEqual(new[] { (1L, 100L, "channelRemoved") }, router.Forfeits.ToArray());
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 20, "test", null)).Success);
    }

    [TestMethod]
    public async Task OldCompletionAfterChannelRecreation_DoesNotMutateReplacementClockOrReadyCheck()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var oldOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var old = await sut.RespondToOfferAsync(oldOffer.OfferId!.Value, 200, true);
        await sut.HandleChannelRemovedAsync(1);
        var replacementOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var queuedOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var replacement = await sut.RespondToOfferAsync(replacementOffer.OfferId!.Value, 400, true);
        var queued = await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(2, replacement.ReservationId!.Value, 1,
            router.Starts[^1].PlayerOne, router.Starts[^1].PlayerTwo, router.Starts[^1].Configuration, DateTimeOffset.UtcNow));
        var before = await sut.GetSnapshotForSessionAsync(50);

        await router.CompleteAsync(new MatchCompletion(1, old.ReservationId!.Value, 1,
            new(10, 100, "user-100"), new(20, 200, "user-200"), router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        var after = await sut.GetSnapshotForSessionAsync(50);

        Assert.AreEqual(queued.ReservationId, after.ReadyCheck?.ReservationId);
        Assert.AreEqual(before.Generation, after.Generation);
        Assert.AreEqual(before.Revision, after.Revision);
    }

    [TestMethod]
    public async Task DuplicateReadyAcceptance_DoesNotChangeRevisionOrPublishAgain()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var readyOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var ready = await sut.RespondToOfferAsync(readyOffer.OfferId!.Value, 400, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        await sut.RespondReadyAsync(ready.ReservationId!.Value, 300, ReadyResponse.Accept);
        var before = await sut.GetSnapshotForSessionAsync(30);
        var events = publisher.UserMessages.Count(x =>
            x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string == "game.readyCheck");

        var duplicate = await sut.RespondReadyAsync(ready.ReservationId.Value, 300, ReadyResponse.Accept);

        Assert.IsTrue(duplicate.Success);
        Assert.AreEqual(before.Revision, (await sut.GetSnapshotForSessionAsync(30)).Revision);
        Assert.AreEqual(events, publisher.UserMessages.Count(x =>
            x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string == "game.readyCheck"));
        await sut.RespondReadyAsync(ready.ReservationId.Value, 400, ReadyResponse.Accept);
        Assert.AreEqual(2, router.Starts.Count);
    }

    [TestMethod]
    public async Task DisposedOldReadyTimers_CannotMutateReplacementOrRemovedChannel()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(clock);
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var firstOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var secondOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var first = await sut.RespondToOfferAsync(firstOffer.OfferId!.Value, 400, true);
        var second = await sut.RespondToOfferAsync(secondOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, clock.GetUtcNow()));
        await sut.RespondReadyAsync(first.ReservationId!.Value, 300, ReadyResponse.Decline);
        var replacement = await sut.GetSnapshotForSessionAsync(50);

        clock.FireTimerEvenIfDisposed(0);
        await Task.Yield();
        Assert.AreEqual(second.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
        await sut.HandleChannelRemovedAsync(1);
        var removed = await sut.GetSnapshotForSessionAsync(50);
        clock.FireTimerEvenIfDisposed(1);
        await Task.Yield();
        var afterStaleTimer = await sut.GetSnapshotForSessionAsync(50);
        Assert.AreEqual(removed.Generation, afterStaleTimer.Generation);
        Assert.AreEqual(removed.Revision, afterStaleTimer.Revision);
    }

    [TestMethod]
    public async Task ReadyPublicationFailure_DoesNotBlockStartOrAdvancement()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 4; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var readyOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var ready = await sut.RespondToOfferAsync(readyOffer.OfferId!.Value, 400, true);
        publisher.FailType = "game.readyCheck";
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));

        await sut.RespondReadyAsync(ready.ReservationId!.Value, 300, ReadyResponse.Accept);
        var result = await sut.RespondReadyAsync(ready.ReservationId.Value, 400, ReadyResponse.Accept);

        Assert.IsTrue(result.Success);
        Assert.AreEqual(2, router.Starts.Count);
    }

    [TestMethod]
    public async Task ReadyCancellationPublicationFailure_DoesNotBlockNextPromotion()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var declinedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var declined = await sut.RespondToOfferAsync(declinedOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        publisher.FailType = "game.commitmentCanceled";

        var result = await sut.RespondReadyAsync(declined.ReservationId!.Value, 300, ReadyResponse.Decline);

        Assert.IsTrue(result.Success);
        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
    }

    [TestMethod]
    public async Task ReadyDecline_ReleasesPairAndImmediatelyPromotesNextPair()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var declinedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var declined = await sut.RespondToOfferAsync(declinedOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));

        Assert.IsTrue((await sut.RespondReadyAsync(declined.ReservationId!.Value, 300, ReadyResponse.Decline)).Success);
        var snapshot = await sut.GetSnapshotForSessionAsync(50);
        Assert.AreEqual(next.ReservationId, snapshot.ReadyCheck?.ReservationId);
        Assert.IsTrue((await sut.CreateChallengeAsync(30, 40, "test", null)).Success);
        Assert.AreEqual(DuelRejectReason.StaleOffer,
            (await sut.RespondReadyAsync(declined.ReservationId.Value, 300, ReadyResponse.Accept)).Reason);
        Assert.AreEqual(DuelRejectReason.NotParticipant,
            (await sut.RespondReadyAsync(next.ReservationId!.Value, 300, ReadyResponse.Accept)).Reason);
    }

    [TestMethod]
    public async Task PresenceLoss_RemovesQueuedPairPromotesNextAndIgnoresWrongSession()
    {
        var (sut, presence, publisher, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var removedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(removedOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);

        await sut.HandlePresenceLostAsync(300, 999, DuelCancelReason.Disconnected);
        Assert.AreEqual(2, (await sut.GetSnapshotForSessionAsync(10)).Queue.Count);
        await sut.HandlePresenceLostAsync(300, 30, DuelCancelReason.LeftChannel);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));

        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
        Assert.IsTrue(publisher.UserMessages.Any(x =>
            x.Users.SetEquals([300L, 400L])
            && x.Message.GetType().GetProperty("reason")?.GetValue(x.Message) as string == "leftChannel"));
    }

    [TestMethod]
    public async Task ActivePresenceLoss_ForfeitsMatchingActiveWithoutReleasingCommitment()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var active = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(77, active.ReservationId!.Value, 1, "test-runner");

        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await WaitUntilAsync(() => router.Forfeits.Count == 1);

        CollectionAssert.AreEqual(new[] { (77L, 100L, "disconnected") }, router.Forfeits.ToArray());
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted,
            (await sut.CreateChallengeAsync(10, 30, "test", null)).Reason);
        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        Assert.AreEqual(1, router.Forfeits.Count);
    }

    [TestMethod]
    public async Task ActiveForfeitDedupe_AllowsSameUserInLaterMatch()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var firstOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var first = await sut.RespondToOfferAsync(firstOffer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(71, first.ReservationId!.Value, 1, "test-runner");
        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await WaitUntilAsync(() => router.Forfeits.Count == 1);
        await router.CompleteAsync(new MatchCompletion(71, first.ReservationId.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        var secondOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var second = await sut.RespondToOfferAsync(secondOffer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(72, second.ReservationId!.Value, 1, "test-runner");

        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await WaitUntilAsync(() => router.Forfeits.Count == 2);

        CollectionAssert.AreEqual(
            new[] { (71L, 100L, "disconnected"), (72L, 100L, "disconnected") },
            router.Forfeits.ToArray());
    }

    [TestMethod]
    public async Task FailedActiveForfeit_RetriesAfterDelayWithoutAnotherPresenceCallback()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(clock);
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var active = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(77, active.ReservationId!.Value, 1, "test-runner");
        router.FailNextForfeit = true;

        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected)
            .WaitAsync(TimeSpan.FromSeconds(1));
        await WaitUntilAsync(() => router.ForfeitAttempts.Count == 1);

        Assert.AreEqual(0, router.Forfeits.Count);
        await WaitUntilAsync(() => clock.TimerCount >= 2);
        clock.Advance(TimeSpan.FromSeconds(1));
        await WaitUntilAsync(() => router.Forfeits.Count == 1);
        Assert.AreEqual(2, router.ForfeitAttempts.Count);
    }

    [TestMethod]
    public async Task ActiveForfeitRetry_StopsWhenMatchCompletesBeforeDelay()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(clock);
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var active = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(77, active.ReservationId!.Value, 1, "test-runner");
        router.FailNextForfeit = true;

        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await WaitUntilAsync(() => router.ForfeitAttempts.Count == 1);
        await router.CompleteAsync(new MatchCompletion(77, active.ReservationId.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, clock.GetUtcNow()));
        clock.Advance(TimeSpan.FromSeconds(1));
        await Task.Yield();

        Assert.AreEqual(1, router.ForfeitAttempts.Count);
        Assert.AreEqual(0, router.Forfeits.Count);
    }

    [TestMethod]
    public async Task ConcurrentActivePresenceLoss_StartsAtMostOneForfeit()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var active = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        router.ActiveMatches[100] = new(77, active.ReservationId!.Value, 1, "test-runner");
        router.ForfeitBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await router.ForfeitEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var duplicate = sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        await duplicate;
        Assert.AreEqual(1, router.ForfeitAttempts.Count);
        router.ForfeitBlock.SetResult();
        await first;
        await WaitUntilAsync(() => router.Forfeits.Count == 1);

        Assert.AreEqual(1, router.ForfeitAttempts.Count);
        Assert.AreEqual(1, router.Forfeits.Count);
    }

    [TestMethod]
    public async Task Advancement_SkipsUnavailablePairAndPromotesNext()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var staleOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var validOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(staleOffer.OfferId!.Value, 400, true);
        var valid = await sut.RespondToOfferAsync(validOffer.OfferId!.Value, 600, true);
        presence.Sessions.Remove(30);

        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));

        Assert.AreEqual(valid.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
        Assert.IsTrue((await sut.CreateChallengeAsync(30, 40, "test", null)).Success == false);
    }

    [TestMethod]
    public async Task ReadyTimeoutAtFifteenSeconds_ReleasesPairAndPromotesNext()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 12, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(clock);
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var timedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var timed = await sut.RespondToOfferAsync(timedOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, clock.GetUtcNow()));

        Assert.AreEqual(clock.GetUtcNow().AddSeconds(15), (await sut.GetSnapshotForSessionAsync(30)).ReadyCheck?.ExpiresAt);
        clock.Advance(TimeSpan.FromSeconds(14));
        Assert.AreEqual(timed.ReservationId, (await sut.GetSnapshotForSessionAsync(30)).ReadyCheck?.ReservationId);
        clock.Advance(TimeSpan.FromSeconds(1));
        await WaitUntilAsync(() => sut.GetSnapshotForSessionAsync(50).Result.ReadyCheck?.ReservationId == next.ReservationId);

        Assert.IsTrue((await sut.CreateChallengeAsync(30, 40, "test", null)).Success);
    }

    [TestMethod]
    public async Task PromotedReadyStartFailure_ImmediatelyPromotesNextPair()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var failingOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var nextOffer = await sut.CreateChallengeAsync(50, 60, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        var failing = await sut.RespondToOfferAsync(failingOffer.OfferId!.Value, 400, true);
        var next = await sut.RespondToOfferAsync(nextOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(1, active.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo, router.Starts[0].Configuration, DateTimeOffset.UtcNow));
        router.FailNextStart = true;

        await sut.RespondReadyAsync(failing.ReservationId!.Value, 300, ReadyResponse.Accept);
        var failed = await sut.RespondReadyAsync(failing.ReservationId.Value, 400, ReadyResponse.Accept);

        Assert.IsFalse(failed.Success);
        Assert.AreEqual(next.ReservationId, (await sut.GetSnapshotForSessionAsync(50)).ReadyCheck?.ReservationId);
    }

    [TestMethod]
    public async Task ChannelRemoval_ReleasesAllCommitmentsAndRecreationKeepsHigherClock()
    {
        var (sut, presence, _, router) = Create();
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var activeOffer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var queuedOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        var active = await sut.RespondToOfferAsync(activeOffer.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 400, true);
        router.ActiveMatches[100] = new(77, active.ReservationId!.Value, 1, "test-runner");
        var before = await sut.GetSnapshotForSessionAsync(10);

        await sut.HandleChannelRemovedAsync(1);
        var empty = await sut.GetSnapshotForSessionAsync(10);
        var replacement = await sut.CreateChallengeAsync(50, 60, "test", null);
        await sut.RespondToOfferAsync(replacement.OfferId!.Value, 600, true);
        var recreated = await sut.GetSnapshotForSessionAsync(50);

        Assert.IsTrue(empty.Generation > before.Generation);
        Assert.IsTrue(empty.Revision > before.Revision);
        Assert.IsTrue(recreated.Generation >= empty.Generation);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 20, "test", null)).Success);
        Assert.AreEqual("channelRemoved", router.Forfeits.Single().Reason);
    }

    [TestMethod]
    public async Task PendingOfferOnlyRemoval_PersistsHigherLifetimeClockOnRecreation()
    {
        var (sut, presence, _, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        Add(presence, 30, 300); Add(presence, 40, 400);
        await sut.CreateChallengeAsync(10, 20, "test", null);
        var before = await sut.GetSnapshotForSessionAsync(10);

        await sut.HandleChannelRemovedAsync(1);
        var replacementOffer = await sut.CreateChallengeAsync(30, 40, "test", null);
        await sut.RespondToOfferAsync(replacementOffer.OfferId!.Value, 400, true);
        var recreated = await sut.GetSnapshotForSessionAsync(30);

        Assert.AreEqual(0L, before.Generation);
        Assert.AreEqual(0L, before.Revision);
        Assert.IsTrue(recreated.Generation > before.Generation);
        Assert.IsTrue(recreated.Revision > before.Revision);
    }

    [TestMethod]
    public async Task CompletionDuringRunnerStart_ReturnsInterruptedWithoutReleasingReplacement()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        router.CompleteDuringStart = true;
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        DuelCommandResult? replacement = null;
        router.AfterCompletionDuringStart = async () =>
        {
            var replacementOffer = await sut.CreateChallengeAsync(10, 30, "test", null);
            replacement = await sut.RespondToOfferAsync(replacementOffer.OfferId!.Value, 300, true);
        };

        var result = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        var blocked = await sut.CreateChallengeAsync(10, 20, "test", null);

        Assert.IsFalse(result.Success);
        Assert.IsTrue(replacement?.Success);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, blocked.Reason);
        Assert.AreEqual(2, router.Starts.Count);
    }

    [TestMethod]
    public async Task UnavailableBeforeAcceptance_ReleasesPairWithoutQueueMutation()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        presence.Sessions.Remove(20);

        var rejected = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        var replacement = await sut.CreateChallengeAsync(10, 30, "test", null);

        Assert.AreEqual(DuelRejectReason.NotPresent, rejected.Reason);
        Assert.IsTrue(replacement.Success);
        Assert.AreEqual(0, router.Starts.Count);
        Assert.AreEqual(0, (await sut.GetSnapshotForSessionAsync(10)).Queue.Count);
    }

    [TestMethod]
    public async Task MixedGameFormats_QueueInAcceptanceOrder()
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var sut = new DuelOrchestrator(
            new GameDefinitionCatalog([new DeathrollEngine(), new RpsEngine()]),
            presence, publisher, router);
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var active = await sut.CreateChallengeAsync(10, 20, "deathroll", null);
        var rps = await sut.CreateChallengeAsync(30, 40, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 5 });
        var deathroll = await sut.CreateChallengeAsync(50, 60, "deathroll",
            new Dictionary<string, object?> { ["startingCeiling"] = 500 });

        await sut.RespondToOfferAsync(active.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(rps.OfferId!.Value, 400, true);
        await sut.RespondToOfferAsync(deathroll.OfferId!.Value, 600, true);
        var snapshot = await sut.GetSnapshotForSessionAsync(10);

        CollectionAssert.AreEqual(new[] { "rps", "deathroll" },
            snapshot.Queue.Select(x => x.GameType).ToArray());
        CollectionAssert.AreEqual(new[] { "bo5", "1v1" },
            snapshot.Queue.Select(x => x.Format).ToArray());
    }

    [TestMethod]
    public async Task PresenceLoss_CancelsPendingOfferAndReleasesBothPlayers()
    {
        var (sut, presence, _, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await sut.CreateChallengeAsync(10, 20, "test", null);

        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        var replacement = await sut.CreateChallengeAsync(20, 30, "test", null);

        Assert.IsTrue(replacement.Success);
    }

    [TestMethod]
    public async Task OwnerCancellation_PublishesOnlyToOfferParticipants()
    {
        var (sut, presence, publisher, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        await sut.CancelOfferAsync(offer.OfferId!.Value, 100);

        var cancellation = publisher.UserMessages.Single(x =>
            x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string == "game.expired");
        CollectionAssert.AreEquivalent(new long[] { 100, 200 }, cancellation.Users.ToArray());
        Assert.IsFalse(cancellation.Users.Contains(300));
        Assert.IsFalse(publisher.UserMessages.Any(x =>
            x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string == "game.declined"));
    }

    [TestMethod]
    public async Task Challenge_TargetCannotCancelAndOfferRemainsForInviter()
    {
        var (sut, presence, publisher, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);

        var targetCancellation = await sut.CancelOfferAsync(offer.OfferId!.Value, 200);
        var inviterCancellation = await sut.CancelOfferAsync(offer.OfferId.Value, 100);

        Assert.IsFalse(targetCancellation.Success);
        Assert.AreEqual(DuelRejectReason.NotParticipant, targetCancellation.Reason);
        Assert.IsTrue(inviterCancellation.Success);
        Assert.IsFalse(publisher.UserMessages.Any(x => MessageValue<string>(x.Message, "type") == "game.declined"));
        Assert.IsTrue(publisher.UserMessages.Any(x => MessageValue<string>(x.Message, "type") == "game.expired"));
    }

    [TestMethod]
    public async Task Rematch_TargetCannotCancelAndOfferRemainsForRequester()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        var offer = await sut.RequestRematchAsync(91, 100);

        var targetCancellation = await sut.CancelOfferAsync(offer.OfferId!.Value, 200);
        var requesterCancellation = await sut.CancelOfferAsync(offer.OfferId.Value, 100);

        Assert.IsFalse(targetCancellation.Success);
        Assert.AreEqual(DuelRejectReason.NotParticipant, targetCancellation.Reason);
        Assert.IsTrue(requesterCancellation.Success);
    }

    [TestMethod]
    public async Task Challenge_PublishesPendingBeforeBlockedTargetInvite()
    {
        var (sut, presence, publisher, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        publisher.BlockType = "game.invited";

        var challenge = sut.CreateChallengeAsync(10, 20, "test", null);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));

        CollectionAssert.AreEqual(new[] { "game.invitePending" },
            publisher.UserMessages.Select(x => x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string).ToArray());
        publisher.Release.TrySetResult();
        Assert.IsTrue((await challenge).Success);
        CollectionAssert.AreEqual(new[] { "game.invitePending", "game.invited" },
            publisher.UserMessages.Select(x => x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string).ToArray());
        Assert.IsTrue(publisher.UserMessages.All(x => x.Message.GetType().GetProperty("offerId") is not null));
        Assert.IsTrue(publisher.UserMessages.All(x => x.Message.GetType().GetProperty("matchId") is null));
    }

    [TestMethod]
    public async Task TargetInvitePublicationFailure_CompensatesPendingAndReleasesCommitments()
    {
        var (sut, presence, publisher, _) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        publisher.FailType = "game.invited";

        var failed = await sut.CreateChallengeAsync(10, 20, "test", null);
        publisher.FailType = null;
        var replacement = await sut.CreateChallengeAsync(10, 30, "test", null);

        Assert.IsFalse(failed.Success);
        Assert.IsTrue(replacement.Success);
        var types = publisher.UserMessages.Select(x =>
            x.Message.GetType().GetProperty("type")?.GetValue(x.Message) as string).ToArray();
        CollectionAssert.Contains(types, "game.invitePending");
        CollectionAssert.Contains(types, "game.expired");
    }

    [TestMethod]
    public async Task RematchAcceptedBehindExistingQueue_PreservesSourceConfigurationAndMatchId()
    {
        var presence = new TestPresence();
        var publisher = new TestPublisher();
        var router = new TestRouter();
        var sut = new DuelOrchestrator(
            new GameDefinitionCatalog([new TestRpsDefinition()]), presence, publisher, router);
        for (var i = 1; i <= 6; i++) Add(presence, i * 10, i * 100);
        var sourceOffer = await sut.CreateChallengeAsync(10, 20, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 5 });
        var waitingOffer = await sut.CreateChallengeAsync(30, 40, "rps", null);
        var queuedOffer = await sut.CreateChallengeAsync(50, 60, "rps", null);
        var source = await sut.RespondToOfferAsync(sourceOffer.OfferId!.Value, 200, true);
        await sut.RespondToOfferAsync(waitingOffer.OfferId!.Value, 400, true);
        await sut.RespondToOfferAsync(queuedOffer.OfferId!.Value, 600, true);
        await router.CompleteAsync(new MatchCompletion(91, source.ReservationId!.Value, 1,
            router.Starts[0].PlayerOne, router.Starts[0].PlayerTwo,
            router.Starts[0].Configuration, DateTimeOffset.UtcNow));

        var rematch = await sut.RequestRematchAsync(91, 100);
        var accepted = await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true);
        var queued = await sut.GetSnapshotForSessionAsync(10);

        Assert.IsTrue(accepted.Success);
        CollectionAssert.AreEqual(new long[] { 500, 100 },
            queued.Queue.Select(x => x.Players[0].UserId).ToArray());
        await sut.RespondReadyAsync(queued.ReadyCheck!.ReservationId, 300, ReadyResponse.Decline);
        var next = await sut.GetSnapshotForSessionAsync(10);
        await sut.RespondReadyAsync(next.ReadyCheck!.ReservationId, 500, ReadyResponse.Accept);
        await sut.RespondReadyAsync(next.ReadyCheck.ReservationId, 600, ReadyResponse.Accept);
        await router.CompleteAsync(new MatchCompletion(92, next.ReadyCheck.ReservationId, 1,
            router.Starts[1].PlayerOne, router.Starts[1].PlayerTwo,
            router.Starts[1].Configuration, DateTimeOffset.UtcNow));
        var promoted = await sut.GetSnapshotForSessionAsync(10);
        await sut.RespondReadyAsync(promoted.ReadyCheck!.ReservationId, 100, ReadyResponse.Accept);
        await sut.RespondReadyAsync(promoted.ReadyCheck.ReservationId, 200, ReadyResponse.Accept);

        var started = router.Starts[2];
        Assert.AreEqual("rps", started.Configuration.GameType);
        Assert.AreEqual("bo5", started.Configuration.Format);
        Assert.AreEqual(4, started.Configuration.RulesetVersion);
        Assert.AreEqual(5, started.Configuration.Options["bestOf"]);
        Assert.AreEqual(91L, started.SourceMatchId);
    }

    [TestMethod]
    public async Task RematchEitherParticipantCanRequest_AddressesOtherWithPrivateMetadata()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);

        var offer = await sut.RequestRematchAsync(91, 200);

        Assert.IsTrue(offer.Success);
        var pending = publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchPending");
        var offered = publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchOffered");
        CollectionAssert.AreEquivalent(new long[] { 200 }, pending.Users.ToArray());
        CollectionAssert.AreEquivalent(new long[] { 100 }, offered.Users.ToArray());
        Assert.AreEqual(91L, MessageValue<long>(offered.Message, "sourceMatchId"));
        Assert.AreEqual("test", MessageValue<string>(offered.Message, "gameType"));
        Assert.AreEqual("limit-10", MessageValue<string>(offered.Message, "format"));
        Assert.AreEqual(4, MessageValue<int>(offered.Message, "rulesetVersion"));
        Assert.AreEqual(30_000, MessageValue<int>(offered.Message, "inviteMs"));
        Assert.IsNotNull(MessageValue<DateTimeOffset>(offered.Message, "expiresAt"));
        Assert.IsNull(offered.Message.GetType().GetProperty("matchId"));
        Assert.IsNull(pending.Message.GetType().GetProperty("matchId"));
    }

    [TestMethod]
    public async Task RematchCanceledWhilePendingPublicationBlocked_DoesNotPublishActionableOrSucceed()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchPending";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await sut.HandlePresenceLostAsync(100, 10, DuelCancelReason.Disconnected);
        publisher.Release.TrySetResult();
        var result = await request;

        Assert.IsFalse(result.Success);
        Assert.AreEqual(DuelRejectReason.StaleOffer, result.Reason);
        Assert.IsFalse(publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchOffered"));
        Assert.AreEqual(0, PrivateCollectionCount(sut, "_rematchOutcomes"));
        Assert.AreEqual(0, PrivateCollectionCount(sut, "_rematchOutcomeOrder"));
        var requesterEvents = publisher.UserMessages
            .Where(x => x.Users.Contains(100))
            .Select(x => MessageValue<string>(x.Message, "type"))
            .Where(x => x is not null && x.StartsWith("game.rematch", StringComparison.Ordinal))
            .ToArray();
        Assert.AreEqual("game.rematchCanceled", requesterEvents[^1]);
        Assert.IsTrue((await sut.CreateChallengeAsync(20, 30, "test", null)).Success);
    }

    [TestMethod]
    public async Task RematchChannelRemovedWhilePendingPublicationBlocked_ReplaysTerminalAfterPending()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchPending";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await sut.HandleChannelRemovedAsync(1);
        publisher.Release.TrySetResult();
        var result = await request;
        var requesterEvents = publisher.UserMessages
            .Where(x => x.Users.Contains(100))
            .Select(x => MessageValue<string>(x.Message, "type"))
            .Where(x => x is not null && x.StartsWith("game.rematch", StringComparison.Ordinal))
            .ToArray();

        Assert.IsFalse(result.Success);
        Assert.IsFalse(requesterEvents.Contains("game.rematchOffered"));
        Assert.AreEqual("game.rematchCanceled", requesterEvents[^1]);
    }

    [TestMethod]
    public async Task RematchCanceledDuringActionablePublication_EndsWithTerminalEventAndFailure()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchOffered";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await sut.HandleChannelRemovedAsync(1);
        publisher.Release.TrySetResult();
        var result = await request;
        var types = publisher.UserMessages.Select(x => MessageValue<string>(x.Message, "type")).ToArray();

        Assert.IsFalse(result.Success);
        Assert.AreEqual(DuelRejectReason.StaleOffer, result.Reason);
        Assert.AreEqual("game.rematchCanceled", types[^1]);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 30, "test", null)).Success);
    }

    [TestMethod]
    public async Task RematchActionablePublicationFailureAfterConcurrentAcceptance_PreservesAcceptedReservation()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchOffered";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var offered = publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchPending");
        var offerId = MessageValue<long>(offered.Message, "offerId");
        var accepted = await sut.RespondToOfferAsync(offerId, 200, true);
        publisher.FailType = "game.rematchOffered";
        publisher.Release.TrySetResult();
        var result = await request;

        Assert.IsTrue(result.Success);
        Assert.AreEqual(offerId, result.OfferId);
        Assert.IsTrue(accepted.Success);
        Assert.AreEqual(2, router.Starts.Count);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted,
            (await sut.RequestRematchAsync(91, 100)).Reason);
        Assert.IsFalse(publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "reason") == "deliveryFailed"));
    }

    [TestMethod]
    public async Task RematchAcceptedWhileActionablePublicationBlocked_ReplaysAcceptedAfterStaleOffer()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchOffered";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var pending = publisher.UserMessages.Single(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchPending");
        var offerId = MessageValue<long>(pending.Message, "offerId");
        var accepted = await sut.RespondToOfferAsync(offerId, 200, true);
        publisher.Release.TrySetResult();
        var result = await request;

        Assert.IsTrue(result.Success);
        Assert.AreEqual(accepted.ReservationId, result.ReservationId);
        foreach (var userId in new long[] { 100, 200 })
        {
            var events = publisher.UserMessages
                .Where(x => x.Users.Contains(userId))
                .Select(x => x.Message)
                .Where(x => MessageValue<string>(x, "type")?.StartsWith("game.rematch", StringComparison.Ordinal) == true)
                .ToArray();
            Assert.AreEqual("game.rematchAccepted", MessageValue<string>(events[^1], "type"));
            Assert.AreEqual(offerId, MessageValue<long>(events[^1], "offerId"));
            Assert.AreEqual(91L, MessageValue<long>(events[^1], "sourceMatchId"));
            Assert.AreEqual(accepted.ReservationId, MessageValue<long?>(events[^1], "reservationId"));
        }
    }

    [TestMethod]
    public async Task RematchAcceptedWhilePendingPublicationBlocked_ReplaysAcceptedAfterStalePending()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        publisher.BlockType = "game.rematchPending";

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var offerId = MessageValue<long>(publisher.BlockedMessage!, "offerId");
        var accepted = await sut.RespondToOfferAsync(offerId, 200, true);
        publisher.Release.TrySetResult();
        var result = await request;
        var requesterEvents = publisher.UserMessages
            .Where(x => x.Users.Contains(100))
            .Select(x => x.Message)
            .Where(x => MessageValue<string>(x, "type")?.StartsWith("game.rematch", StringComparison.Ordinal) == true)
            .ToArray();

        Assert.IsTrue(result.Success);
        Assert.AreEqual(accepted.ReservationId, result.ReservationId);
        Assert.AreEqual("game.rematchAccepted", MessageValue<string>(requesterEvents[^1], "type"));
        Assert.AreEqual(91L, MessageValue<long>(requesterEvents[^1], "sourceMatchId"));
        Assert.AreEqual(accepted.ReservationId, MessageValue<long?>(requesterEvents[^1], "reservationId"));
        Assert.IsFalse(publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchOffered"));
    }

    [DataTestMethod]
    [DataRow("game.rematchPending", false)]
    [DataRow("game.rematchPending", true)]
    [DataRow("game.rematchOffered", false)]
    [DataRow("game.rematchOffered", true)]
    public async Task RematchExactExpiryDuringPublication_ReplaysExpiredTerminal(
        string blockedType, bool publicationFails)
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, publisher, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91, time.GetUtcNow());
        var timersBeforeRequest = time.TimerCount;
        publisher.BlockType = blockedType;
        if (publicationFails) publisher.FailType = blockedType;

        var request = sut.RequestRematchAsync(91, 100);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.AreEqual(timersBeforeRequest + 1, time.TimerCount);
        var offerId = MessageValue<long>(publisher.BlockedMessage!, "offerId");
        var expiresAt = MessageValue<DateTimeOffset>(publisher.BlockedMessage!, "expiresAt");
        Assert.AreEqual(time.GetUtcNow().AddSeconds(30), expiresAt);

        time.Advance(TimeSpan.FromSeconds(30));
        await WaitUntilAsync(() => publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchExpired"));
        publisher.Release.TrySetResult();
        var result = await request;
        var relevant = publisher.UserMessages
            .Where(x => x.Users.Contains(100))
            .Select(x => x.Message)
            .Where(x => MessageValue<long>(x, "offerId") == offerId)
            .ToArray();

        Assert.IsFalse(result.Success);
        Assert.AreEqual(DuelRejectReason.StaleOffer, result.Reason);
        Assert.AreEqual("game.rematchExpired", MessageValue<string>(relevant[^1], "type"));
        Assert.AreEqual("expired", MessageValue<string>(relevant[^1], "reason"));
        Assert.AreEqual(DuelRejectReason.StaleOffer,
            (await sut.RespondToOfferAsync(offerId, 200, true)).Reason);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 30, "test", null)).Success);
    }

    [TestMethod]
    public async Task RematchUnavailableBeforeAccept_CancelsPublishesAndReleasesBoth()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);
        var rematch = await sut.RequestRematchAsync(91, 100);
        presence.Sessions.Remove(20);

        var response = await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true);

        Assert.IsFalse(response.Success);
        Assert.AreEqual(DuelRejectReason.NotPresent, response.Reason);
        Assert.AreEqual(1, router.Starts.Count);
        var relevant = publisher.UserMessages
            .Where(x => MessageValue<long>(x.Message, "offerId") == rematch.OfferId)
            .Select(x => x.Message).ToArray();
        Assert.AreEqual("game.rematchCanceled", MessageValue<string>(relevant[^1], "type"));
        Assert.AreEqual("notPresent", MessageValue<string>(relevant[^1], "reason"));
        Assert.AreEqual(DuelRejectReason.StaleOffer,
            (await sut.RespondToOfferAsync(rematch.OfferId.Value, 200, true)).Reason);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 30, "test", null)).Success);
    }

    [DataTestMethod]
    [DataRow("game.rematchPending", true)]
    [DataRow("game.rematchPending", false)]
    [DataRow("game.rematchOffered", true)]
    [DataRow("game.rematchOffered", false)]
    public async Task RematchSynchronousTransitionBeforePublicationReturns_FinalizesExactOutcome(
        string publicationType, bool accept)
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        DuelCommandResult? transition = null;
        publisher.BeforeReturn = async message =>
        {
            if (MessageValue<string>(message, "type") != publicationType) return;
            transition = await sut.RespondToOfferAsync(MessageValue<long>(message, "offerId"), 200, accept);
        };

        var result = await sut.RequestRematchAsync(91, 100);
        var relevant = publisher.UserMessages
            .Where(x => x.Message.GetType().GetProperty("sourceMatchId") is not null
                && MessageValue<long>(x.Message, "sourceMatchId") == 91)
            .Select(x => x.Message).ToArray();

        Assert.IsNotNull(transition);
        Assert.AreEqual(accept, result.Success);
        Assert.AreEqual(accept ? "game.rematchAccepted" : "game.rematchDeclined",
            MessageValue<string>(relevant[^1], "type"));
        Assert.AreEqual(accept ? transition.ReservationId : null,
            MessageValue<long?>(relevant[^1], "reservationId"));
    }

    [TestMethod]
    public async Task RematchResolvedOffer_DisposesTimerAndStaleCallbackIsNoOp()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, publisher, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91, time.GetUtcNow());
        var timerIndex = time.TimerCount;
        var rematch = await sut.RequestRematchAsync(91, 100);
        await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, false);
        var terminalCount = publisher.UserMessages.Count(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchDeclined");

        time.Advance(TimeSpan.FromSeconds(30));
        time.FireTimerEvenIfDisposed(timerIndex);
        await Task.Delay(10);

        Assert.AreEqual(terminalCount, publisher.UserMessages.Count(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchDeclined"));
        Assert.IsFalse(publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchExpired"
            && MessageValue<long>(x.Message, "offerId") == rematch.OfferId));
    }

    [TestMethod]
    public async Task AcceptedRematch_DisposesOfferTimer()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91, time.GetUtcNow());
        var timerIndex = time.TimerCount;
        var rematch = await sut.RequestRematchAsync(91, 100);

        await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true);

        Assert.IsTrue(time.IsTimerDisposed(timerIndex));
    }

    [TestMethod]
    public async Task RematchRejectsNonparticipantMissingExpiredUnavailableAndCommittedSources()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91, time.GetUtcNow());

        Assert.AreEqual(DuelRejectReason.NotParticipant, (await sut.RequestRematchAsync(91, 300)).Reason);
        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(404, 100)).Reason);
        presence.Sessions[20] = (2, true, 200, "user-200");
        Assert.AreEqual(DuelRejectReason.NotPresent, (await sut.RequestRematchAsync(91, 100)).Reason);
        presence.Sessions.Remove(20);
        Add(presence, 21, 200);
        Assert.AreEqual(DuelRejectReason.NotPresent, (await sut.RequestRematchAsync(91, 100)).Reason);
        presence.Sessions.Remove(21);
        presence.Sessions[20] = (1, true, 200, "user-200");
        var commitment = await sut.CreateChallengeAsync(10, 30, "test", null);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, (await sut.RequestRematchAsync(91, 100)).Reason);
        await sut.CancelOfferAsync(commitment.OfferId!.Value, 100);
        time.Advance(TimeSpan.FromMinutes(31));
        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(91, 100)).Reason);
    }

    [TestMethod]
    public async Task RematchPendingReservesBothAndConcurrentRequestsCommitExactlyOnce()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);

        var requests = await Task.WhenAll(
            sut.RequestRematchAsync(91, 100),
            sut.RequestRematchAsync(91, 200));
        var winner = requests.Single(x => x.Success);

        Assert.AreEqual(1, requests.Count(x => x.Success));
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted, requests.Single(x => !x.Success).Reason);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted,
            (await sut.CreateChallengeAsync(10, 30, "test", null)).Reason);
        Assert.AreEqual(DuelRejectReason.AlreadyCommitted,
            (await sut.CreateChallengeAsync(20, 30, "test", null)).Reason);
        var responder = MessageValue<long>(
            publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchOffered").Message,
            "toUserId");
        var accepted = await Task.WhenAll(
            sut.RespondToOfferAsync(winner.OfferId!.Value, responder, true),
            sut.RespondToOfferAsync(winner.OfferId.Value, responder, true));
        Assert.AreEqual(1, accepted.Count(x => x.Success));
        Assert.AreEqual(DuelRejectReason.StaleOffer, accepted.Single(x => !x.Success).Reason);
        Assert.AreEqual(2, router.Starts.Count);
    }

    [TestMethod]
    public async Task RematchOfferExpiresAfterThirtySecondsReleasesBothAndLaterResponseIsStale()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, publisher, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91, time.GetUtcNow());
        var rematch = await sut.RequestRematchAsync(91, 100);

        time.Advance(TimeSpan.FromSeconds(30));
        await WaitUntilAsync(() => publisher.UserMessages.Any(x =>
            MessageValue<string>(x.Message, "type") == "game.rematchExpired"));

        Assert.AreEqual(DuelRejectReason.StaleOffer,
            (await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true)).Reason);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 30, "test", null)).Success);
        var expired = publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchExpired");
        CollectionAssert.AreEquivalent(new long[] { 100, 200 }, expired.Users.ToArray());
        Assert.AreEqual("expired", MessageValue<string>(expired.Message, "reason"));
        Assert.AreEqual(91L, MessageValue<long>(expired.Message, "sourceMatchId"));
    }

    [DataTestMethod]
    [DataRow(DuelCancelReason.Disconnected, "disconnected")]
    [DataRow(DuelCancelReason.LeftChannel, "leftChannel")]
    public async Task RematchPresenceLossInvalidatesOfferAndReleasesBoth(DuelCancelReason reason, string expectedReason)
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);
        var rematch = await sut.RequestRematchAsync(91, 100);

        await sut.HandlePresenceLostAsync(100, 10, reason);

        Assert.AreEqual(DuelRejectReason.StaleOffer,
            (await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true)).Reason);
        Assert.IsTrue((await sut.CreateChallengeAsync(20, 30, "test", null)).Success);
        var canceled = publisher.UserMessages.Single(x => MessageValue<string>(x.Message, "type") == "game.rematchCanceled");
        Assert.AreEqual(expectedReason, MessageValue<string>(canceled.Message, "reason"));
    }

    [TestMethod]
    public async Task RematchPublicationFailureCompensatesAndChannelRemovalClearsSource()
    {
        var (sut, presence, publisher, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300);
        await CompleteMatchAsync(sut, router, 91);
        publisher.FailType = "game.rematchOffered";

        var failed = await sut.RequestRematchAsync(91, 100);
        publisher.FailType = null;
        Assert.IsFalse(failed.Success);
        Assert.IsTrue((await sut.CreateChallengeAsync(10, 30, "test", null)).Success);
        await sut.HandleChannelRemovedAsync(1);
        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(91, 100)).Reason);
    }

    [TestMethod]
    public async Task RematchCompletedSourceRetentionKeepsNewestThousandAndIgnoresDuplicateCompletion()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 25, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        for (var matchId = 1L; matchId <= 1001; matchId++)
            await CompleteMatchAsync(sut, router, matchId, time.GetUtcNow());

        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(1, 100)).Reason);
        var newest = await sut.RequestRematchAsync(1001, 100);
        Assert.IsTrue(newest.Success);
        await sut.CancelOfferAsync(newest.OfferId!.Value, 100);
        await router.CompleteAsync(new MatchCompletion(1001, -1, 1,
            new(10, 100, "changed"), new(20, 200, "changed"),
            new("changed", "changed", 99, new Dictionary<string, object?>(), "changed"), time.GetUtcNow()));
        var stable = await sut.RequestRematchAsync(1001, 100);
        await sut.RespondToOfferAsync(stable.OfferId!.Value, 200, true);
        Assert.AreEqual("test", router.Starts[^1].Configuration.GameType);
        Assert.AreEqual(1001L, router.Starts[^1].SourceMatchId);
    }

    [TestMethod]
    public async Task RematchSourceCopiesConfigurationOptionsAtCompletion()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);
        ((Dictionary<string, object?>)router.Starts[0].Configuration.Options)["limit"] = 99;

        var rematch = await sut.RequestRematchAsync(91, 100);
        await sut.RespondToOfferAsync(rematch.OfferId!.Value, 200, true);

        Assert.AreEqual(10, router.Starts[^1].Configuration.Options["limit"]);
    }

    [TestMethod]
    public async Task RematchSourceExpiryUsesEndedAtAndExpiresAtExactThirtyMinuteBoundary()
    {
        var now = new DateTimeOffset(2026, 7, 25, 1, 0, 0, TimeSpan.Zero);
        var time = new TestTimeProvider(now);
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91, now.AddMinutes(-30));

        var result = await sut.RequestRematchAsync(91, 100);

        Assert.AreEqual(DuelRejectReason.StaleOffer, result.Reason);
    }

    [TestMethod]
    public async Task RematchChannelRemovalClearsCompletedSourceOrderStorage()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100);
        Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 91);

        await sut.HandleChannelRemovedAsync(1);

        var order = typeof(DuelOrchestrator)
            .GetField("_completedSourceOrder", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(sut)!;
        Assert.AreEqual(0, (int)order.GetType().GetProperty("Count")!.GetValue(order)!);
    }

    [TestMethod]
    public async Task RematchAgeRetentionPrunesOlderCompletionInsertedAfterNewer()
    {
        var now = new DateTimeOffset(2026, 7, 25, 1, 0, 0, TimeSpan.Zero);
        var time = new TestTimeProvider(now);
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 92, now.AddMinutes(-1));
        await CompleteMatchAsync(sut, router, 91, now.AddMinutes(-31));

        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(91, 100)).Reason);
        Assert.IsTrue((await sut.RequestRematchAsync(92, 100)).Success);
    }

    [TestMethod]
    public async Task RematchCapacityRetentionRemovesChronologicalOldestRegardlessOfCallbackOrder()
    {
        var now = new DateTimeOffset(2026, 7, 25, 1, 0, 0, TimeSpan.Zero);
        var time = new TestTimeProvider(now);
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        await CompleteMatchAsync(sut, router, 1, now);
        for (var matchId = 2L; matchId <= 1001; matchId++)
            await CompleteMatchAsync(sut, router, matchId, now.AddMinutes(-1));

        Assert.AreEqual(DuelRejectReason.StaleOffer, (await sut.RequestRematchAsync(2, 100)).Reason);
        Assert.IsTrue((await sut.RequestRematchAsync(1, 100)).Success);
    }

    private static async Task CompleteMatchAsync(
        DuelOrchestrator sut, TestRouter router, long matchId, DateTimeOffset? endedAt = null)
    {
        var offer = await sut.CreateChallengeAsync(10, 20, "test", null);
        var accepted = await sut.RespondToOfferAsync(offer.OfferId!.Value, 200, true);
        var started = router.Starts[^1];
        await router.CompleteAsync(new MatchCompletion(matchId, accepted.ReservationId!.Value, 1,
            started.PlayerOne, started.PlayerTwo, started.Configuration, endedAt ?? DateTimeOffset.UtcNow));
    }

    private static T? MessageValue<T>(object message, string name) =>
        (T?)message.GetType().GetProperty(name)?.GetValue(message);

    private static int PrivateCollectionCount(object instance, string fieldName)
    {
        var value = instance.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;
        return (int)value.GetType().GetProperty("Count")!.GetValue(value)!;
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(5);
        while (!condition())
        {
            if (DateTimeOffset.UtcNow >= deadline) Assert.Fail("Condition was not reached.");
            await Task.Delay(10);
        }
    }
}
