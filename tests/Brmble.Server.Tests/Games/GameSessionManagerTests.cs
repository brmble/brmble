using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class ManagerPublisher : IGameEventPublisher
{
    public List<object> Messages { get; } = [];
    public Task PublishToUsersAsync(IReadOnlySet<long> users, object message) { Messages.Add(message); return Task.CompletedTask; }
    public Task PublishToChannelAsync(int channelId, object message) { Messages.Add(message); return Task.CompletedTask; }
}

file sealed class ManagerRandom : IRandomSource
{
    public int Roll(int maxInclusive) => maxInclusive <= 1 ? 1 : Math.Max(1, maxInclusive / 2);
}

file sealed class ManagerSink : ICompletedMatchSink
{
    public List<CompletedMatch> Matches { get; } = [];
    public void Enqueue(CompletedMatch match) => Matches.Add(match);
}

[TestClass]
public class GameSessionManagerTests
{
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
