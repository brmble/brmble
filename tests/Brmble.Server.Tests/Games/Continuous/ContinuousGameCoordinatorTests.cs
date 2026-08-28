using System.Text.Json;
using Brmble.Server.Games;
using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Auth;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public sealed class ContinuousGameCoordinatorTests
{
    [TestMethod]
    public async Task BothAcksTransitionToLoadingAndAnAttachedSocketAloneDoesNot()
    {
        var h = await Harness.StartAsync();
        await h.AttachAsync(501, 10, "one");
        await h.AttachAsync(502, 20, "two");

        Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Simulation.Phase);
        h.Coordinator.AcknowledgeAttach("one", 1);
        Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Simulation.Phase);
        h.Coordinator.AcknowledgeAttach("two", 1);
        Assert.AreEqual(ContinuousMatchPhase.Loading, h.Simulation.Phase);
    }

    [TestMethod]
    public async Task FirstLoadingWaitsForBothAttachAcksAndFifteenSecondFailureForfeits()
    {
        var h = await Harness.StartAsync();
        await h.AttachAsync(501, 10, "one", acknowledge: true);

        h.Time.Advance(TimeSpan.FromSeconds(14));
        Assert.IsNull(h.Sink.Match);
        h.Time.Advance(TimeSpan.FromSeconds(1));

        Assert.AreEqual("connection_timeout", h.Sink.Match!.AbandonReason);
        Assert.AreEqual(502, h.Sink.Match.Participants.Single(x => x.Result == "abandoned").UserId);
    }

    [TestMethod]
    public async Task ReconnectRequiresCompleteAckAndContinuesAtTheNextInputSequence()
    {
        var h = await Harness.LiveAsync();
        Assert.IsTrue(h.Coordinator.SubmitInput(h.MatchId, 10, RealtimeRole.Participant,
            new ContinuousInput(1, h.Simulation.Tick, 0, 0, 32767, 0, false, false, false), false).Accepted);
        await h.Coordinator.DetachAsync("one");
        h.Time.Advance(TimeSpan.FromMilliseconds(4_999));

        var replacement = await h.AttachAsync(501, 11, "replacement");
        Assert.IsTrue(replacement.Ok);
        Assert.AreEqual(1, replacement.Welcome!.AcknowledgedInput);
        Assert.AreEqual(h.Simulation.Tick, replacement.Welcome.ServerTick);
        var input = h.Simulation.Players.Single(x => x.SessionId == 10).Input;
        Assert.IsTrue(input.MoveX == 0 && input.MoveY == 0 && !input.Charging);
        h.Coordinator.AcknowledgeAttach("replacement", replacement.Welcome.SnapshotSequence);
        h.Time.Advance(TimeSpan.FromMilliseconds(2));

        Assert.IsNull(h.Sink.Match);
        Assert.IsTrue(h.Coordinator.TryGetActiveMatch(501, out _));
        var next = h.Coordinator.SubmitInput(h.MatchId, 11, RealtimeRole.Participant,
            new ContinuousInput(2, h.Simulation.Tick, 0, 0, 32767, 0, false, false, false), false);
        Assert.IsTrue(next.Accepted);
    }

    [TestMethod]
    public async Task SimulationContinuesDuringGraceAndExpiryForfeitsWholeMatch()
    {
        var h = await Harness.LiveAsync();
        var before = h.Simulation.Tick;

        await h.Coordinator.DetachAsync("one");
        h.Time.Advance(TimeSpan.FromSeconds(2));
        await Task.Yield();
        Assert.IsTrue(h.Simulation.Tick > before);
        h.Time.Advance(TimeSpan.FromMilliseconds(3_001));

        Assert.AreEqual("realtime_disconnect", h.Sink.Match!.AbandonReason);
        Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
    }

    [TestMethod]
    public async Task CompletionClosesMailboxesReleasesOwnershipAndNeverPublishesSnapshots()
    {
        var h = await Harness.LiveAsync();

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test_forfeit");

        Assert.IsTrue(h.MatchCompletedRaised);
        Assert.AreEqual("arena-knockoff", h.Sink.Match!.GameType);
        CollectionAssert.AreEquivalent(new long[] { 501, 502 }, h.Sink.Match.Participants.Select(x => x.UserId).ToArray());
        Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
        Assert.AreEqual(0, h.Publisher.SnapshotEventCount);
        Assert.AreEqual("matchClosed", await ReadTerminalTypeAsync(h.Mailboxes[10]));
        Assert.AreEqual("matchClosed", await ReadTerminalTypeAsync(h.Mailboxes[20]));
    }

    [TestMethod]
    public async Task StartRejectsNonCanonicalArenaConfigurationAndPublishesStartedLifecycle()
    {
        var h = await Harness.CreateAsync();
        var invalid = await h.Coordinator.StartAsync(Harness.Reservation(format: "bo5"));
        Assert.IsFalse(invalid.Success);

        var valid = await h.Coordinator.StartAsync(Harness.Reservation());
        Assert.IsTrue(valid.Success);
        Assert.AreEqual("game.started", h.Publisher.Types.Single());
    }

    [TestMethod]
    public async Task WelcomeAndSnapshotUseExactCamelCaseProtocolEnvelope()
    {
        var h = await Harness.StartAsync();
        var attached = await h.AttachAsync(501, 10, "one");
        var welcome = await h.Mailboxes[10].ReadNextAsync(default);
        var snapshot = await h.Mailboxes[10].ReadNextAsync(default);

        using var welcomeJson = JsonDocument.Parse(welcome.Json);
        Assert.AreEqual("welcome", welcomeJson.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("participant", welcomeJson.RootElement.GetProperty("role").GetString());
        Assert.AreEqual(attached.Welcome!.AcknowledgedInput,
            welcomeJson.RootElement.GetProperty("acknowledgedInput").GetInt64());
        using var snapshotJson = JsonDocument.Parse(snapshot.Json);
        Assert.AreEqual(1, snapshotJson.RootElement.GetProperty("sequence").GetInt64());
        Assert.IsTrue(snapshotJson.RootElement.TryGetProperty("serverTick", out _));
        Assert.IsFalse(snapshotJson.RootElement.GetProperty("players")[0].TryGetProperty("serverTick", out _));
    }

    [TestMethod]
    public async Task UnauthorizedAttachAndStaleAckCannotReplaceOrStartParticipant()
    {
        var h = await Harness.StartAsync();
        var unauthorized = await h.Coordinator.AttachParticipantAsync(
            h.MatchId, 999, 99, "bad", new RealtimeSnapshotMailbox());
        Assert.IsFalse(unauthorized.Ok);

        await h.AttachAsync(501, 10, "one");
        h.Coordinator.AcknowledgeAttach("one", 999);
        await h.AttachAsync(502, 20, "two", acknowledge: true);
        Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Simulation.Phase);
    }

    [TestMethod]
    public async Task ConcurrentCompletionIsExactlyOnce()
    {
        var h = await Harness.LiveAsync();
        await Task.WhenAll(
            h.Coordinator.ForfeitAsync(h.MatchId, 501, "first"),
            h.Coordinator.ForfeitAsync(h.MatchId, 502, "second"));

        Assert.AreEqual(1, h.Sink.Count);
        Assert.AreEqual(1, h.MatchCompletedCount);
        Assert.AreEqual(1, h.Publisher.Types.Count(x => x == "game.ended"));
    }

    [TestMethod]
    public void AddGamesRegistersArenaUnderBothDefinitionsAndCoordinatorAsRunner()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-continuous-{Guid.NewGuid():N}.db");
        var database = new Database($"Data Source={path}");
        database.Initialize();
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddSingleton(database);
        builder.Services.AddSingleton(new Mock<ISessionMappingService>().Object);
        builder.Services.AddSingleton(new Mock<IChannelMembershipService>().Object);
        builder.Services.AddSingleton(new UserRepository(database, Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local",
        })));
        builder.Services.AddSingleton(new Mock<IBrmbleEventBus>().Object);
        builder.Services.AddGames();
        using var host = builder.Build();

        var arena = host.Services.GetRequiredService<ArenaGameDefinition>();
        Assert.IsTrue(host.Services.GetServices<IDuelGameDefinition>().Any(x => ReferenceEquals(x, arena)));
        Assert.IsTrue(host.Services.GetServices<IContinuousGameDefinition>().Any(x => ReferenceEquals(x, arena)));
        var coordinator = host.Services.GetRequiredService<ContinuousGameCoordinator>();
        Assert.IsTrue(host.Services.GetServices<IDuelMatchRunner>().Any(x => ReferenceEquals(x, coordinator)));
    }

    private sealed class Harness
    {
        private Harness(ManualTimeProvider time, CapturingDefinition definition, RecordingSink sink,
            RecordingPublisher publisher, ContinuousGameCoordinator coordinator)
        {
            Time = time;
            Definition = definition;
            Sink = sink;
            Publisher = publisher;
            Coordinator = coordinator;
        }

        public ManualTimeProvider Time { get; }
        public CapturingDefinition Definition { get; }
        public ArenaSimulation Simulation => Definition.Simulation!;
        public RecordingSink Sink { get; }
        public RecordingPublisher Publisher { get; }
        public ContinuousGameCoordinator Coordinator { get; }
        public long MatchId { get; private set; }
        public bool MatchCompletedRaised => MatchCompletedCount > 0;
        public int MatchCompletedCount { get; private set; }
        public Dictionary<long, RealtimeSnapshotMailbox> Mailboxes { get; } = [];

        public static Task<Harness> CreateAsync()
        {
            var time = new ManualTimeProvider();
            var definition = new CapturingDefinition();
            var sink = new RecordingSink();
            var publisher = new RecordingPublisher();
            return Task.FromResult(new Harness(time, definition, sink, publisher,
                new ContinuousGameCoordinator([definition], time, sink, publisher,
                    NullLogger<ContinuousGameCoordinator>.Instance)));
        }

        public static async Task<Harness> StartAsync()
        {
            var h = await CreateAsync();
            var result = await h.Coordinator.StartAsync(Reservation());
            Assert.IsTrue(result.Success, result.Error);
            h.MatchId = result.MatchId;
            h.Coordinator.MatchCompleted += _ =>
            {
                h.MatchCompletedCount++;
                return Task.CompletedTask;
            };
            return h;
        }

        public static async Task<Harness> LiveAsync()
        {
            var h = await StartAsync();
            await h.AttachAsync(501, 10, "one", acknowledge: true);
            await h.AttachAsync(502, 20, "two", acknowledge: true);
            Assert.AreEqual(ContinuousMatchPhase.Loading, h.Simulation.Phase);
            return h;
        }

        public async Task<AttachResult> AttachAsync(
            long userId, long sessionId, string connectionId, bool acknowledge = false)
        {
            var mailbox = new RealtimeSnapshotMailbox();
            Mailboxes[sessionId] = mailbox;
            var result = await Coordinator.AttachParticipantAsync(
                MatchId, userId, sessionId, connectionId, mailbox);
            Assert.IsTrue(result.Ok, result.Error);
            if (acknowledge)
                Coordinator.AcknowledgeAttach(connectionId, result.Welcome!.SnapshotSequence);
            return result;
        }

        public static DuelReservation Reservation(string format = "bo3") => new(
            9, 7, new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
            new DuelConfiguration("arena-knockoff", format, 1, new Dictionary<string, object?>(), "continuous"),
            DateTimeOffset.UnixEpoch, 1, null);
    }

    private static async Task<string> ReadTerminalTypeAsync(RealtimeSnapshotMailbox mailbox)
    {
        for (var count = 0; count < 3; count++)
        {
            var message = await mailbox.ReadNextAsync(default);
            if (message.Type == "matchClosed") return message.Type;
        }
        return "missing";
    }

    private sealed class CapturingDefinition : IContinuousGameDefinition
    {
        public string GameType => "arena-knockoff";
        public int RulesetVersion => 1;
        public object PredictionConstants => ArenaRulesetV1.PredictionConstants;
        public ArenaSimulation? Simulation { get; private set; }
        public IContinuousSimulation Create(DuelReservation reservation) => Simulation = new ArenaSimulation(reservation);
    }

    private sealed class RecordingSink : ICompletedMatchSink
    {
        public CompletedMatch? Match { get; private set; }
        public int Count { get; private set; }
        public void Enqueue(CompletedMatch match) { Match = match; Count++; }
    }

    private sealed class RecordingPublisher : IGameEventPublisher
    {
        public List<string> Types { get; } = [];
        public int SnapshotEventCount { get; private set; }
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
        {
            var json = JsonSerializer.Serialize(message);
            using var document = JsonDocument.Parse(json);
            var type = document.RootElement.GetProperty("type").GetString()!;
            Types.Add(type);
            if (type == "snapshot") SnapshotEventCount++;
            return Task.CompletedTask;
        }
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private readonly List<ManualTimer> _timers = [];
        private long _timestamp;
        public override long TimestampFrequency => 1_000;
        public override long GetTimestamp() => _timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(_timestamp);
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(this, callback, state, dueTime, period);
            _timers.Add(timer);
            return timer;
        }
        public void Advance(TimeSpan by)
        {
            _timestamp += (long)by.TotalMilliseconds;
            foreach (var timer in _timers.ToArray()) timer.FireIfDue();
        }
        private sealed class ManualTimer : ITimer
        {
            private readonly ManualTimeProvider _owner;
            private readonly TimerCallback _callback;
            private readonly object? _state;
            private long _due;
            private long _period;
            private bool _disposed;
            public ManualTimer(ManualTimeProvider owner, TimerCallback callback, object? state,
                TimeSpan dueTime, TimeSpan period)
            {
                _owner = owner; _callback = callback; _state = state;
                Change(dueTime, period);
            }
            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                if (_disposed) return false;
                _due = dueTime == Timeout.InfiniteTimeSpan ? long.MaxValue : _owner._timestamp + (long)dueTime.TotalMilliseconds;
                _period = period == Timeout.InfiniteTimeSpan ? 0 : (long)period.TotalMilliseconds;
                return true;
            }
            public void FireIfDue()
            {
                if (_disposed || _owner._timestamp < _due) return;
                _due = _period > 0 ? _due + _period : long.MaxValue;
                _callback(_state);
            }
            public void Dispose() => _disposed = true;
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }
}
