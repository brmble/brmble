using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

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
    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        lock (UserMessages) UserMessages.Add((userIds, message));
        return Task.CompletedTask;
    }
    public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
}

internal sealed class TestRouter : IDuelMatchRunnerRouter
{
    private long _matchId;
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public List<DuelReservation> Starts { get; } = [];
    public TaskCompletionSource? StartBlock { get; set; }
    public bool FailNextStart { get; set; }

    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        lock (Starts) Starts.Add(reservation);
        if (StartBlock is not null) await StartBlock.Task;
        if (FailNextStart)
        {
            FailNextStart = false;
            return new(false, 0, null, "start failed");
        }
        return new(true, Interlocked.Increment(ref _matchId), DateTimeOffset.UtcNow, null);
    }

    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match) { match = null!; return false; }
    public Task ForfeitAsync(long matchId, long userId, string reason) => Task.CompletedTask;
    public Task CompleteAsync(MatchCompletion completion) => MatchCompleted?.Invoke(completion) ?? Task.CompletedTask;
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
        return (new DuelOrchestrator(catalog, presence, publisher, router), presence, publisher, router);
    }

    private static void Add(TestPresence presence, long session, long user, int channel = 1) =>
        presence.Sessions[session] = (channel, true, user, $"user-{user}");

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
    public async Task StartFailure_AdvancesAlreadyQueuedPair()
    {
        var (sut, presence, _, router) = Create();
        Add(presence, 10, 100); Add(presence, 20, 200); Add(presence, 30, 300); Add(presence, 40, 400);
        var first = await sut.CreateChallengeAsync(10, 20, "test", null);
        var second = await sut.CreateChallengeAsync(30, 40, "test", null);
        router.StartBlock = new(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstAcceptance = sut.RespondToOfferAsync(first.OfferId!.Value, 200, true);
        await WaitUntilAsync(() => router.Starts.Count == 1);
        await sut.RespondToOfferAsync(second.OfferId!.Value, 400, true);
        router.FailNextStart = true;
        router.StartBlock.SetResult();
        await firstAcceptance;
        await WaitUntilAsync(() => router.Starts.Count == 2);

        Assert.AreEqual(300L, router.Starts[1].PlayerOne.UserId);
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
