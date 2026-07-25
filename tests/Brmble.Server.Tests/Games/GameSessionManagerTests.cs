using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Engines;
using Dapper;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

internal sealed class ManagerPublisher : IGameEventPublisher
{
    public List<object> Messages { get; } = [];
    public string? BlockType { get; set; }
    public string? FailType { get; set; }
    public TaskCompletionSource Blocked { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task PublishToUsersAsync(IReadOnlySet<long> users, object message) => await PublishAsync(message);
    public async Task PublishToChannelAsync(int channelId, object message) => await PublishAsync(message);
    private async Task PublishAsync(object message)
    {
        lock (Messages) Messages.Add(message);
        var type = MessageType(message);
        if (type == BlockType) { Blocked.TrySetResult(); await Release.Task; }
        if (type == FailType) throw new InvalidOperationException($"{type} failed");
    }
    private static string? MessageType(object message) => message.GetType().GetProperty("type")?.GetValue(message) as string;
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
    public async Task ActionWhileStartedPublicationAwaits_IsAppliedBeforeTimerStartsAfterDelivery()
    {
        var publisher = new ManagerPublisher { BlockType = "game.started" };
        var timers = new RecordingTimerFactory();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink(), timers);
        var start = manager.StartAsync(Reservation(80));
        await publisher.Blocked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.IsTrue(manager.TryGetActiveMatch(100, out var active));

        await manager.ActionAsync(active.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        Assert.AreEqual(0, timers.Timers.Count);
        Assert.IsTrue(publisher.Messages.Any(x => MessageType(x) == "game.stateUpdated"));
        publisher.Release.TrySetResult();
        var result = await start;

        Assert.IsTrue(result.Success);
        Assert.AreEqual(1, timers.Timers.Count);
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

        await manager.ForfeitAsync(active.MatchId, 100, "disconnect");
        publisher.Release.TrySetResult();
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
        await manager.ForfeitAsync(old.MatchId, 100, "disconnect");
        publisher.BlockType = null;
        var replacement = await manager.StartAsync(Reservation(84));

        publisher.Release.TrySetException(new InvalidOperationException("old publish failed"));
        var oldResult = await oldStart;

        Assert.IsFalse(oldResult.Success);
        Assert.IsTrue(replacement.Success);
        Assert.IsTrue(manager.TryGetActiveMatch(100, out var current));
        Assert.AreEqual(replacement.MatchId, current.MatchId);
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
