using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Engines;
using Brmble.Server.Games.Spectators;
using Dapper;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Text.Json;

namespace Brmble.Server.Tests.Games;

internal sealed class ManagerPublisher : IGameEventPublisher
{
    public List<object> Messages { get; } = [];
    public List<object> Delivered { get; } = [];
    public string? BlockType { get; set; }
    public string? FailType { get; set; }
    public bool FailOnce { get; set; }
    public TaskCompletionSource Blocked { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task PublishToUsersAsync(IReadOnlySet<long> users, object message) => await PublishAsync(message);
    public async Task PublishToChannelAsync(int channelId, object message) => await PublishAsync(message);
    private async Task PublishAsync(object message)
    {
        lock (Messages) Messages.Add(message);
        var type = MessageType(message);
        if (type == BlockType && Blocked.TrySetResult()) await Release.Task;
        if (type == FailType)
        {
            if (FailOnce) FailType = null;
            throw new InvalidOperationException($"{type} failed");
        }
        lock (Delivered) Delivered.Add(message);
    }
    private static string? MessageType(object message) => message.GetType().GetProperty("type")?.GetValue(message) as string;
}

internal sealed class RecordingSpectators : ISpectatorCoordinator
{
    public List<SpectatorSourceFrame> Frames { get; } = [];
    public List<(long MatchId, int ChannelId, long FinalSequence, MatchEndReason Reason, object Outcome)> Ends { get; } = [];

    public Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId)
        => Task.FromResult(new SpectatorSubscribeResult(true, null, SpectatorSubscribeReason.None));

    public Task UnsubscribeAsync(long sessionId, long userId) => Task.CompletedTask;

    public Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame)
    {
        lock (Frames) Frames.Add(frame);
        return Task.CompletedTask;
    }

    public Task EndMatchAsync(long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome)
    {
        lock (Ends) Ends.Add((matchId, channelId, finalSequence, reason, outcome));
        return Task.CompletedTask;
    }

    public Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match) => Task.CompletedTask;

    public Task<SpectatorAuthorizationResult> AuthorizeAsync(long sessionId, long userId, long matchId, SpectatorRole role)
        => Task.FromResult(new SpectatorAuthorizationResult(false, role, SpectatorSubscribeReason.NotPresent));
}

internal sealed class ManagerRandom : IRandomSource
{
    public int Roll(int maxInclusive) => maxInclusive <= 1 ? 1 : Math.Max(1, maxInclusive / 2);
}

internal sealed class ManagerSink : ICompletedMatchSink
{
    public List<CompletedMatch> Matches { get; } = [];
    public void Enqueue(CompletedMatch match) => Matches.Add(match);
}

internal sealed class RecordingTimerFactory : IGameTimerFactory
{
    public List<(TimerCallback Callback, object? State, TimeSpan Due)> Timers { get; } = [];

    public IDisposable Create(TimerCallback callback, object? state, TimeSpan due)
    {
        Timers.Add((callback, state, due));
        return new RecordingTimer();
    }

    private sealed class RecordingTimer : IDisposable
    {
        public void Dispose() { }
    }
}

[TestClass]
public class GameSessionManagerTests
{
    private static string? MessageType(object message) => message.GetType().GetProperty("type")?.GetValue(message) as string;
    private static List<string> FeedTexts(ManagerPublisher publisher) => publisher.Messages
        .Where(x => MessageType(x) == "game.feed")
        .Select(x => x.GetType().GetProperty("text")?.GetValue(x) as string ?? "").ToList();
    private static GameSessionManager Manager(ManagerPublisher publisher, ICompletedMatchSink sink) =>
        new([new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, sink);

    [TestMethod]
    public async Task ActionWhileStartedPublicationAwaits_IsDeliveredAfterStartedBeforeTimerStarts()
    {
        var publisher = new ManagerPublisher { BlockType = "game.started" };
        var timers = new RecordingTimerFactory();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink(), timers);
        var start = manager.StartAsync(Reservation(80));
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.IsTrue(manager.TryGetActiveMatch(100, out var active));

        var action = manager.ActionAsync(active.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        Assert.AreEqual(0, timers.Timers.Count);
        Assert.IsFalse(action.IsCompleted);
        Assert.IsFalse(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
        publisher.Release.TrySetResult();
        await Task.WhenAll(start, action);
        var result = await start;

        Assert.IsTrue(result.Success);
        Assert.AreEqual(1, timers.Timers.Count);
        CollectionAssert.AreEqual(
            new[] { "game.started", "game.stateUpdated" },
            publisher.Delivered.Select(MessageType)
                .Where(type => type is "game.started" or "game.stateUpdated")
                .ToArray());
    }

    [TestMethod]
    public async Task ForfeitAtLiveTransition_DeliversStartedBeforeEndedWithoutStaleStartup()
    {
        var publisher = new ManagerPublisher();
        GameSessionManager? manager = null;
        Task? forfeit = null;
        manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink(),
            new RecordingTimerFactory(),
            matchId => forfeit = manager!.ForfeitAsync(matchId, 100, "disconnect"));

        var result = await manager.StartAsync(Reservation(801));
        Assert.IsNotNull(forfeit);
        await forfeit;

        CollectionAssert.AreEqual(
            new[] { "game.started", "game.ended" },
            publisher.Delivered.Select(MessageType)
                .Where(type => type is "game.started" or "game.ended")
                .ToArray());
        Assert.IsFalse(result.Success);
        Assert.IsFalse(manager.IsMatchLive(result.MatchId));
    }

    [TestMethod]
    public async Task AdvisoryStartupPublicationFailure_DoesNotRollbackObservableMatch()
    {
        var publisher = new ManagerPublisher { FailType = "game.duelState" };
        var sink = new ManagerSink();
        var manager = Manager(publisher, sink);

        var result = await manager.StartAsync(Reservation(81));
        await manager.ActionAsync(result.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        await manager.ForfeitAsync(result.MatchId, 100, "quit");

        Assert.IsTrue(result.Success);
        Assert.IsTrue(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
        Assert.AreEqual(1, sink.Matches.Count);
    }

    [TestMethod]
    public async Task CompletionDuringStartedPublication_ReturnsFailureWithoutLaterStartupEvents()
    {
        var publisher = new ManagerPublisher { BlockType = "game.started" };
        var sink = new ManagerSink();
        var timers = new RecordingTimerFactory();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, sink, timers);
        var completions = 0;
        manager.MatchCompleted += _ => { completions++; return Task.CompletedTask; };
        var start = manager.StartAsync(Reservation(82));
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        manager.TryGetActiveMatch(100, out var active);

        var forfeit = manager.ForfeitAsync(active.MatchId, 100, "disconnect");
        Assert.IsFalse(forfeit.IsCompleted);
        publisher.Release.TrySetResult();
        await Task.WhenAll(start, forfeit);
        var result = await start;
        await manager.FireTurnTimeoutForTestAsync(active.MatchId);

        Assert.IsFalse(result.Success);
        Assert.AreEqual(0, timers.Timers.Count);
        Assert.AreEqual(1, completions);
        Assert.IsFalse(manager.IsMatchLive(active.MatchId));
        Assert.IsFalse(publisher.Messages.Any(x => MessageType(x) == "game.duelState"
            && x.GetType().GetProperty("active")?.GetValue(x) is true));
        Assert.IsFalse(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
    }

    [TestMethod]
    public async Task FailedOldStartupCleanup_PreservesReplacementRuntimeMappings()
    {
        var publisher = new ManagerPublisher { BlockType = "game.started" };
        var sink = new ManagerSink();
        var manager = Manager(publisher, sink);
        var oldStart = manager.StartAsync(Reservation(83));
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        manager.TryGetActiveMatch(100, out var old);
        var forfeit = manager.ForfeitAsync(old.MatchId, 100, "disconnect");
        publisher.BlockType = null;
        var overlapping = await manager.StartAsync(Reservation(84));

        publisher.Release.TrySetException(new InvalidOperationException("old publish failed"));
        await Task.WhenAll(oldStart, forfeit);
        var oldResult = await oldStart;
        var replacement = await manager.StartAsync(Reservation(84));

        Assert.IsFalse(oldResult.Success);
        Assert.IsFalse(overlapping.Success);
        Assert.IsTrue(replacement.Success);
        Assert.IsTrue(manager.TryGetActiveMatch(100, out var current));
        Assert.AreEqual(replacement.MatchId, current.MatchId);
    }
    [TestMethod]
    public async Task CompletionSubscriberFailure_DoesNotFaultTheCompletingAction()
    {
        var sink = new ManagerSink();
        var manager = new GameSessionManager([new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), sink);
        manager.MatchCompleted += _ => throw new InvalidOperationException("orchestrator advance failed");

        var started = await manager.StartAsync(Reservation(93));
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        Assert.IsFalse(manager.IsMatchLive(started.MatchId), "runtime state must still be released");
        Assert.IsFalse(manager.TryGetActiveMatch(10, out _), "player one must not stay committed");
        Assert.IsFalse(manager.TryGetActiveMatch(20, out _), "player two must not stay committed");
    }

    [TestMethod]
    public async Task StartAsync_UsesImmutableReservationConfiguration_AndCompletesWithCanonicalMetadata()
    {
        var sink = new ManagerSink();
        var manager = new GameSessionManager([new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), sink);
        var configuration = new DuelConfiguration("rps", "bo5", 3,
            new Dictionary<string, object?> { ["bestOf"] = 5 }, "discrete");
        var reservation = Reservation(91, configuration);
        MatchCompletion? completion = null;
        manager.MatchCompleted += value => { completion = value; return Task.CompletedTask; };

        var started = await manager.StartAsync(reservation);
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        Assert.IsTrue(started.Success);
        Assert.IsNotNull(completion);
        Assert.AreEqual(91L, completion.ReservationId);
        Assert.AreSame(configuration, completion.Configuration);
        Assert.AreEqual("bo5", sink.Matches.Single().Format);
        Assert.AreEqual(3, sink.Matches.Single().RulesetVersion);
    }

    [TestMethod]
    public async Task LifecycleEvents_IncludeCanonicalConfiguration()
    {
        var publisher = new ManagerPublisher();
        var manager = Manager(publisher, new ManagerSink());
        var configuration = new DuelConfiguration("rps", "bo5", 3,
            new Dictionary<string, object?> { ["bestOf"] = 5, ["suddenDeath"] = true }, "discrete");

        var started = await manager.StartAsync(Reservation(911, configuration));
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        var startedJson = JsonSerializer.Serialize(
            publisher.Messages.Single(x => MessageType(x) == "game.started"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var endedJson = JsonSerializer.Serialize(
            publisher.Messages.Single(x => MessageType(x) == "game.ended"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach (var payload in new[] { startedJson, endedJson })
        {
            StringAssert.Contains(payload, "\"format\":\"bo5\"");
            StringAssert.Contains(payload, "\"rulesetVersion\":3");
            StringAssert.Contains(payload, "\"options\":{\"bestOf\":5,\"suddenDeath\":true}");
        }
    }

    [TestMethod]
    public async Task AbandonedLifecycleEvent_IncludesCanonicalConfiguration()
    {
        var publisher = new ManagerPublisher();
        var manager = Manager(publisher, new ManagerSink());
        var configuration = new DuelConfiguration("rps", "bo5", 3,
            new Dictionary<string, object?> { ["bestOf"] = 5 }, "discrete");

        var started = await manager.StartAsync(Reservation(912, configuration));
        await manager.ForfeitAsync(started.MatchId, 100, "quit");

        var payload = JsonSerializer.Serialize(
            publisher.Messages.Single(x => MessageType(x) == "game.ended"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        StringAssert.Contains(payload, "\"format\":\"bo5\"");
        StringAssert.Contains(payload, "\"rulesetVersion\":3");
        StringAssert.Contains(payload, "\"options\":{\"bestOf\":5}");
    }

    [TestMethod]
    public async Task Forfeit_ReleasesRuntimeBeforePersistenceWorkerRuns()
    {
        var sink = new ManagerSink();
        var manager = new GameSessionManager([new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), sink);
        var started = await manager.StartAsync(Reservation(92));

        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");

        Assert.IsFalse(manager.TryGetActiveMatch(100, out _));
        Assert.IsFalse(manager.TryGetActiveMatch(200, out _));
        Assert.AreEqual(1, sink.Matches.Count);
    }

    [TestMethod]
    public async Task RunnerForfeit_UsesStableUserIdentity()
    {
        var sink = new ManagerSink();
        var manager = new GameSessionManager([new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), sink);
        var started = await manager.StartAsync(Reservation(93));

        await manager.ForfeitAsync(started.MatchId, userId: 10, "session-id-collision");

        Assert.IsTrue(manager.IsMatchLive(started.MatchId));
        Assert.IsTrue(manager.TryGetActiveMatch(100, out _));
        Assert.AreEqual(0, sink.Matches.Count);
    }

    [TestMethod]
    public async Task Deathroll_PlaysToCompletion_PersistsAndPublishesFeed()
    {
        var publisher = new ManagerPublisher();
        var repo = GameTestHelpers.NewRepo();
        var manager = Manager(publisher, new ImmediateSink(repo));
        var started = await manager.StartAsync(DeathrollReservation(94));

        for (var i = 0; i < 100 && manager.IsMatchLive(started.MatchId); i++)
            await manager.ActionAsync(started.MatchId, manager.GetCurrentPlayer(started.MatchId),
                new Dictionary<string, object?> { ["roll"] = true });

        Assert.IsFalse(manager.IsMatchLive(started.MatchId));
        Assert.IsTrue(FeedTexts(publisher).Any(x => x.Contains("started")));
        Assert.IsTrue(FeedTexts(publisher).Any(x => x.StartsWith("🎲")));
        Assert.AreEqual(1, FeedTexts(publisher).Count(x => x.StartsWith("💀")));
        Assert.AreEqual(1, (await repo.GetUserStatsAsync(100, "deathroll")).GamesPlayed);
    }

    [TestMethod]
    public async Task CompletedDeathroll_PersistsVersionedMetadataEnvelope()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var manager = Manager(new ManagerPublisher(), new ImmediateSink(repo));
        var started = await manager.StartAsync(DeathrollReservation(95));
        for (var i = 0; i < 100 && manager.IsMatchLive(started.MatchId); i++)
            await manager.ActionAsync(started.MatchId, manager.GetCurrentPlayer(started.MatchId),
                new Dictionary<string, object?> { ["roll"] = true });

        using var connection = db.CreateConnection();
        var match = await connection.QuerySingleAsync<string>("SELECT metadata_json FROM game_matches LIMIT 1");
        var participants = (await connection.QueryAsync<string>("SELECT metadata_json FROM game_match_participants")).ToArray();
        Assert.IsTrue(match.Contains("\"schemaVersion\":1"));
        Assert.IsTrue(match.Contains("startingCeiling"));
        Assert.AreEqual(2, participants.Length);
        Assert.IsTrue(participants.All(x => x.Contains("displayName") && x.Contains("deathroll")));
    }

    [TestMethod]
    public async Task Forfeit_PersistsMetadata_AndNonparticipantIsIgnored()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var manager = Manager(new ManagerPublisher(), new ImmediateSink(repo));
        var started = await manager.StartAsync(DeathrollReservation(96));

        await manager.ForfeitAsync(started.MatchId, 999, "grief");
        Assert.IsTrue(manager.IsMatchLive(started.MatchId));
        await manager.ForfeitAsync(started.MatchId, 100, "quit");

        using var connection = db.CreateConnection();
        Assert.AreEqual(1L, await connection.QuerySingleAsync<long>("SELECT COUNT(*) FROM game_matches"));
        var metadata = await connection.QuerySingleAsync<string>("SELECT metadata_json FROM game_matches LIMIT 1");
        Assert.IsTrue(metadata.Contains("\"schemaVersion\":1"));
    }

    [TestMethod]
    public async Task Action_NonparticipantIsIgnored_AndParticipantPublishesState()
    {
        var publisher = new ManagerPublisher();
        var manager = Manager(publisher, new ManagerSink());
        var started = await manager.StartAsync(Reservation(961));

        await manager.ActionAsync(started.MatchId, 99, new Dictionary<string, object?> { ["pick"] = "rock" });
        Assert.IsFalse(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });

        Assert.IsTrue(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
        Assert.IsTrue(manager.IsMatchLive(started.MatchId));
    }

    [TestMethod]
    public async Task Rps_PlaysToCompletion_PersistsAndPublishesFeed()
    {
        var publisher = new ManagerPublisher();
        var repo = GameTestHelpers.NewRepo();
        var manager = Manager(publisher, new ImmediateSink(repo));
        var started = await manager.StartAsync(Reservation(97));
        for (var round = 0; round < 2; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        Assert.IsFalse(manager.IsMatchLive(started.MatchId));
        Assert.IsTrue(FeedTexts(publisher).Any(x => x.StartsWith("✊")));
        Assert.AreEqual(1, FeedTexts(publisher).Count(x => x.StartsWith("🏆")));
        Assert.AreEqual(1, (await repo.GetUserStatsAsync(100, "rps")).Wins);
    }

    [TestMethod]
    public async Task Rps_FirstPickDoesNotRestartSharedWindow()
    {
        var publisher = new ManagerPublisher();
        var manager = Manager(publisher, new ManagerSink());
        var started = await manager.StartAsync(Reservation(98));

        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        Assert.AreEqual(false, LastTurnStarted(publisher));
        await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        Assert.AreEqual(true, LastTurnStarted(publisher));
    }

    [TestMethod]
    public async Task Rps_BothIdleTwice_EndsAsPersistedDraw()
    {
        var publisher = new ManagerPublisher();
        var repo = GameTestHelpers.NewRepo();
        var manager = Manager(publisher, new ImmediateSink(repo));
        var started = await manager.StartAsync(Reservation(99));

        await manager.FireTurnTimeoutForTestAsync(started.MatchId);
        await manager.FireTurnTimeoutForTestAsync(started.MatchId);

        var ended = publisher.Messages.Last(x => MessageType(x) == "game.ended");
        Assert.AreEqual(true, ended.GetType().GetProperty("draw")?.GetValue(ended));
        Assert.AreEqual(1, (await repo.GetUserStatsAsync(100, "rps")).Draws);
        Assert.AreEqual(1, (await repo.GetUserStatsAsync(200, "rps")).Draws);
    }

    [TestMethod]
    public async Task ConcurrentTimeouts_DeliverStateInMutationOrderBeforeEnded()
    {
        var publisher = new ManagerPublisher { BlockType = "game.stateUpdated" };
        var manager = Manager(publisher, new ManagerSink());
        var started = await manager.StartAsync(Reservation(991));

        var firstTimeout = manager.FireTurnTimeoutForTestAsync(started.MatchId);
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var secondTimeout = manager.FireTurnTimeoutForTestAsync(started.MatchId);

        Assert.IsFalse(secondTimeout.IsCompleted, "A later mutation must await earlier outbound delivery.");
        Assert.IsFalse(publisher.Delivered.Any(x => MessageType(x) == "game.ended"));

        publisher.Release.TrySetResult();
        await Task.WhenAll(firstTimeout, secondTimeout);

        CollectionAssert.AreEqual(
            new[] { "game.stateUpdated", "game.stateUpdated", "game.ended" },
            publisher.Delivered.Select(MessageType)
                .Where(type => type is "game.stateUpdated" or "game.ended")
                .ToArray());
    }

    [TestMethod]
    public async Task FailedPublication_DoesNotPoisonLaterMatchPublications()
    {
        var publisher = new ManagerPublisher { FailType = "game.stateUpdated", FailOnce = true };
        var manager = Manager(publisher, new ManagerSink());
        var started = await manager.StartAsync(Reservation(992));

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() =>
            manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" }));
        await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });

        Assert.AreEqual(1, publisher.Delivered.Count(x => MessageType(x) == "game.stateUpdated"));
        Assert.IsTrue(manager.IsMatchLive(started.MatchId));
    }

    [TestMethod]
    public async Task FailedFinalStatePublication_StillDrainsCompletionAndReleasesRuntime()
    {
        var publisher = new ManagerPublisher();
        var sink = new ManagerSink();
        var manager = Manager(publisher, sink);
        var started = await manager.StartAsync(Reservation(993));
        await manager.FireTurnTimeoutForTestAsync(started.MatchId);
        publisher.FailType = "game.stateUpdated";
        publisher.FailOnce = true;

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() =>
            manager.FireTurnTimeoutForTestAsync(started.MatchId));

        Assert.IsFalse(manager.TryGetActiveMatch(100, out _));
        Assert.AreEqual(1, sink.Matches.Count);
        Assert.IsTrue(publisher.Delivered.Any(x => MessageType(x) == "game.ended"));
    }

    [TestMethod]
    public async Task Spectator_SequencesAreMonotonicAndUniqueAcrossStartActionAndTimeout()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        var started = await manager.StartAsync(Reservation(94));
        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "paper" });
        await manager.FireTurnTimeoutForTestAsync(started.MatchId);

        var sequences = spectators.Frames.Select(f => f.Sequence).ToArray();
        CollectionAssert.AllItemsAreUnique(sequences);
        CollectionAssert.AreEqual(sequences.OrderBy(s => s).ToArray(), sequences, "Sequences must be monotonic.");
        Assert.AreEqual(1L, sequences[0], "The first frame is the start state.");
        Assert.IsTrue(sequences.Length >= 4, "Start, two actions and one timeout each produce a frame.");
    }

    [TestMethod]
    public async Task Spectator_FrameExcludesParticipantsAndCarriesTheEngineView()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        await manager.StartAsync(DeathrollReservation(95));

        var frame = spectators.Frames.First();
        CollectionAssert.AreEquivalent(new[] { 100L, 200L }, frame.ParticipantUserIds.ToArray());
        CollectionAssert.AreEquivalent(new[] { 10L, 20L }, frame.Players.Select(p => p.SessionId).ToArray());
        Assert.IsInstanceOfType<DeathrollSpectatorView>(frame.View);
        Assert.AreEqual("deathroll", frame.Configuration.GameType);
    }

    [TestMethod]
    public async Task Spectator_MatchEnd_FiresExactlyOnceOnCompletion()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(96));
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        var end = spectators.Ends.Single();
        Assert.AreEqual(started.MatchId, end.MatchId);
        Assert.AreEqual(MatchEndReason.Completed, end.Reason);
        Assert.AreEqual(spectators.Frames.Last().Sequence, end.FinalSequence);
    }

    [TestMethod]
    public async Task Spectator_Forfeit_EndsWithNoFabricatedFrame()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(97));
        var beforeFrames = spectators.Frames.Count;
        var beforeSequence = spectators.Frames.Last().Sequence;

        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");

        Assert.AreEqual(beforeFrames, spectators.Frames.Count, "A forfeit fabricates no frame.");
        var end = spectators.Ends.Single();
        Assert.AreEqual(MatchEndReason.Forfeited, end.Reason);
        Assert.AreEqual(beforeSequence, end.FinalSequence, "finalSequence is the last COMPLETE frame.");
    }

    [TestMethod]
    public async Task Spectator_ViewPlayerIdsAreSessionIdsThatJoinToTheSnapshotPlayers()
    {
        // The engine's state is keyed by Mumble SESSION id, and SpectatorView returns
        // an opaque `object` that GameSessionManager deliberately cannot inspect — so
        // there is no translation step and none should ever be added. The client joins
        // view ids against players[].sessionId, which is why DuelPlayerSnapshot must
        // keep carrying BOTH ids. This test fails loudly if a future engine emits db
        // user ids into a view instead.
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        await manager.StartAsync(DeathrollReservation(99));

        var frame = spectators.Frames.First();
        var view = (DeathrollSpectatorView)frame.View;
        var sessionIds = frame.Players.Select(p => p.SessionId).ToHashSet();
        var userIds = frame.Players.Select(p => p.UserId).ToHashSet();

        foreach (var id in view.Players)
            Assert.IsTrue(sessionIds.Contains(id), $"View player {id} is not a session id of this match.");
        Assert.IsFalse(view.Players.Any(userIds.Contains),
            "View player ids must be session ids, not db user ids.");
    }

    // Runs a scenario that reaches ALL THREE closures a spectator publish was inserted
    // into (start, action, turn-timeout) plus the completion terminal path, and returns
    // the full participant/channel message type sequence.
    private static async Task<(List<string?> Types, long MatchId)> RunCompletionScenarioAsync(
        RecordingSpectators? spectators)
    {
        var publisher = new ManagerPublisher();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(400));
        // One unresolved commit (action closure, no round result), then a timeout that
        // resolves the round (timeout closure), then resolved rounds to completion.
        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        await manager.FireTurnTimeoutForTestAsync(started.MatchId);
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }
        return (publisher.Messages.Select(MessageType).ToList(), started.MatchId);
    }

    private static async Task<List<string?>> RunForfeitScenarioAsync(RecordingSpectators? spectators)
    {
        var publisher = new ManagerPublisher();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(401));
        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");
        return publisher.Messages.Select(MessageType).ToList();
    }

    [TestMethod]
    public async Task Spectator_ParticipantMessageSequenceIsIdenticalWithAndWithoutACoordinator()
    {
        // The 804 pre-existing tests all run with a NULL coordinator, so they cannot
        // catch a regression on the coordinator-PRESENT path — which is the only path
        // this change adds await points to. This compares the FULL message type
        // sequence (game.started, game.stateUpdated, game.duelState, game.feed,
        // game.ended) between the two, so ordering inside the outbound tail is observed.
        var spectators = new RecordingSpectators();
        var (withSpectators, matchId) = await RunCompletionScenarioAsync(spectators);
        var (without, _) = await RunCompletionScenarioAsync(null);

        CollectionAssert.AreEqual(without, withSpectators,
            "A spectator coordinator must not change participant events, their shape or their order.");

        // Prove the scenario really reached the instrumented closures and the terminal
        // path, so the equivalence above is not vacuous.
        Assert.IsTrue(withSpectators.Contains("game.ended"), "The scenario must reach a terminal path.");
        Assert.IsTrue(spectators.Frames.Count >= 4,
            "Start, action and timeout closures must each have produced a frame.");
        var end = spectators.Ends.Single();
        Assert.AreEqual(matchId, end.MatchId);
        Assert.AreEqual(MatchEndReason.Completed, end.Reason);
    }

    [TestMethod]
    public async Task Spectator_ForfeitParticipantMessageSequenceIsIdenticalWithAndWithoutACoordinator()
    {
        var spectators = new RecordingSpectators();
        var withSpectators = await RunForfeitScenarioAsync(spectators);
        var without = await RunForfeitScenarioAsync(null);

        CollectionAssert.AreEqual(without, withSpectators,
            "A spectator coordinator must not change the forfeit event sequence.");
        Assert.IsTrue(withSpectators.Contains("game.ended"));
        Assert.AreEqual(MatchEndReason.Forfeited, spectators.Ends.Single().Reason);
    }

    [TestMethod]
    public async Task Spectator_NullCoordinator_ChangesNothing()
    {
        var publisher = new ManagerPublisher();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink());

        var started = await manager.StartAsync(Reservation(98));
        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");

        CollectionAssert.AreEqual(
            new[] { "game.started", "game.ended" },
            publisher.Messages.Select(MessageType).Where(t => t is "game.started" or "game.ended").ToArray());
    }

    private static bool? LastTurnStarted(ManagerPublisher publisher)
    {
        var message = publisher.Messages.Last(x => MessageType(x) == "game.stateUpdated");
        return message.GetType().GetProperty("turnStarted")?.GetValue(message) as bool?;
    }

    private static DuelReservation DeathrollReservation(long id) => Reservation(id,
        new DuelConfiguration("deathroll", "1v1", 1, new Dictionary<string, object?>(), "discrete"));

    private static DuelReservation Reservation(long id, DuelConfiguration? configuration = null) => new(
        id,
        7,
        new DuelPlayer(10, 100, "Alice"),
        new DuelPlayer(20, 200, "Bob"),
        configuration ?? new DuelConfiguration("rps", "bo3", 1,
            new Dictionary<string, object?> { ["bestOf"] = 3 }, "discrete"),
        DateTimeOffset.UtcNow,
        id,
        null);
}

internal sealed class ImmediateSink(GameRepository repository) : ICompletedMatchSink
{
    public void Enqueue(CompletedMatch match) => repository.SaveCompletedMatchAsync(match).GetAwaiter().GetResult();
}
