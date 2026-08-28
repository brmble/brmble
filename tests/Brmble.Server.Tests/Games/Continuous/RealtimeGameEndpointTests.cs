using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Games;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Brmble.Server.Tests.Integration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class RealtimeGameEndpointTests
{
    [TestMethod]
    public async Task MissingExpiredAndReusedTicketsAreRejectedBeforeUpgrade()
    {
        await using (var h = await RealtimeHarness.CreateAsync())
        {
            await h.AssertUpgradeRejectedAsync(null);
            var expired = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
            h.Time.Advance(TimeSpan.FromSeconds(15));
            await h.AssertUpgradeRejectedAsync(expired.Token);
        }
        await using (var h = await RealtimeHarness.CreateAsync())
        {
            var used = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
            using var socket = await h.ConnectAsync(used.Token);
            await h.AssertUpgradeRejectedAsync(used.Token);
        }
    }

    [TestMethod]
    public async Task MultipleTicketQueryValuesAreRejectedWithoutConsumingEitherTicket()
    {
        await using var h = await RealtimeHarness.CreateAsync();
        var first = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        var second = h.Tickets.Issue(502, 20, h.MatchId, RealtimeRole.Participant);
        await h.AssertUpgradeRejectedUriAsync(
            $"ws://localhost/games/realtime?ticket={first.Token}&ticket={second.Token}");

        using var socket = await h.ConnectAsync(first.Token);
        using var welcome = await h.ReceiveJsonAsync(socket);
        Assert.AreEqual(10, welcome.RootElement.GetProperty("sessionId").GetInt64());
    }

    [TestMethod]
    public async Task ValidParticipantReceivesTheVersionOneWelcomeContract()
    {
        await using var h = await RealtimeHarness.ConnectedParticipantAsync();
        using var welcome = await h.ReceiveJsonAsync();
        var root = welcome.RootElement;
        Assert.AreEqual("welcome", root.GetProperty("type").GetString());
        Assert.AreEqual(1, root.GetProperty("protocolVersion").GetInt32());
        Assert.AreEqual(1, root.GetProperty("rulesetVersion").GetInt32());
        Assert.AreEqual("participant", root.GetProperty("role").GetString());
        Assert.AreEqual(60, root.GetProperty("tickRate").GetInt32());
        Assert.AreEqual(20, root.GetProperty("snapshotRate").GetInt32());
        Assert.AreEqual(100, root.GetProperty("interpolationMs").GetInt32());
        Assert.AreEqual(50, root.GetProperty("maxExtrapolationMs").GetInt32());
        Assert.AreEqual(250, root.GetProperty("inputHeartbeatMs").GetInt32());
        Assert.AreEqual(750, root.GetProperty("neutralAfterMs").GetInt32());
        Assert.AreEqual(5000, root.GetProperty("reconnectGraceMs").GetInt32());
        Assert.AreEqual(1000, root.GetProperty("prediction").GetProperty("unitsPerWorldUnit").GetInt32());
        Assert.AreEqual(240, root.GetProperty("prediction").GetProperty("dashPerTick").GetInt32());
    }

    [TestMethod]
    public async Task SpectatorTicketIsRejectedAsWrongRoleWithoutAttachment()
    {
        await using var h = await RealtimeHarness.CreateAsync();
        var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Spectator);
        await h.AssertUpgradeRejectedAsync(ticket.Token);
        var participant = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        using var socket = await h.ConnectAsync(participant.Token);
        using var welcome = await h.ReceiveJsonAsync(socket);
        Assert.AreEqual("participant", welcome.RootElement.GetProperty("role").GetString());
    }

    [TestMethod]
    public async Task InvalidClientPayloadsCloseWithInvalidPayloadData()
    {
        foreach (var payload in new[]
        {
            "{",
            "{\"type\":\"telemetry\",\"protocolVersion\":1,\"matchId\":1}",
            "{\"type\":\"heartbeat\",\"protocolVersion\":0,\"matchId\":1}",
            "{\"type\":\"heartbeat\",\"protocolVersion\":1,\"matchId\":999}",
        })
        {
            await using var h = await RealtimeHarness.ConnectedParticipantAsync();
            _ = await h.ReceiveJsonAsync();
            await h.SendTextAsync(payload.Replace("\"matchId\":1", $"\"matchId\":{h.MatchId}"));
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }
    }

    [TestMethod]
    public async Task FragmentedTextIsAcceptedButBinaryAndPayloadAbove64KiBAreRejected()
    {
        await using (var h = await RealtimeHarness.ConnectedParticipantAsync())
        {
            using var welcome = await h.ReceiveJsonAsync();
            var sequence = welcome.RootElement.GetProperty("snapshotSequence").GetInt64();
            var payload = Encoding.UTF8.GetBytes($"{{\"type\":\"attachAck\",\"protocolVersion\":1,\"matchId\":{h.MatchId},\"snapshotSequence\":{sequence}}}");
            await h.Socket!.SendAsync(payload.AsMemory(0, 12), WebSocketMessageType.Text, false, default);
            await h.Socket.SendAsync(payload.AsMemory(12), WebSocketMessageType.Text, true, default);
            await h.Socket.SendAsync(new byte[] { 1 }, WebSocketMessageType.Binary, true, default);
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }

        await using (var h = await RealtimeHarness.ConnectedParticipantAsync())
        {
            _ = await h.ReceiveJsonAsync();
            await h.SendTextAsync(new string('x', 65_537));
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }
    }

    [TestMethod]
    public async Task MissingOrUnlistedOriginIsRejectedOutsideDevelopment()
    {
        await using var h = await RealtimeHarness.CreateAsync();
        var missing = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        await h.AssertUpgradeRejectedAsync(missing.Token, origin: null);
        var unlisted = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        await h.AssertUpgradeRejectedAsync(unlisted.Token, "https://evil.test");
    }

    [TestMethod]
    public async Task ConsumedTicketWhoseMatchEndedCannotBeRetried()
    {
        await using var h = await RealtimeHarness.CreateAsync();
        var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test");
        await h.AssertUpgradeRejectedAsync(ticket.Token);
        await h.AssertUpgradeRejectedAsync(ticket.Token);
    }

    [TestMethod]
    public async Task InputRejectionUsesReliableControlAndCamelCaseReason()
    {
        await using var h = await RealtimeHarness.ConnectedParticipantAsync();
        using var welcome = await h.ReceiveJsonAsync();
        await h.SendTextAsync($$"""
            {"type":"attachAck","protocolVersion":1,"matchId":{{h.MatchId}},"snapshotSequence":{{welcome.RootElement.GetProperty("snapshotSequence").GetInt64()}}}
            """);
        _ = await h.ReceiveJsonAsync();
        await h.SendTextAsync($$"""
            {"type":"input","protocolVersion":1,"matchId":{{h.MatchId}},"sequence":2,"predictedTick":0,"moveX":0,"moveY":0,"aimX":32767,"aimY":0,"charging":false,"fireReleased":false,"dash":false}
            """);
        using var rejected = await h.ReceiveJsonAsync();
        Assert.AreEqual("inputRejected", rejected.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("sequenceGap", rejected.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task SocketCloseDetachesExactlyOnceAndAllowsReattachment()
    {
        await using var h = await RealtimeHarness.ConnectedParticipantAsync();
        _ = await h.ReceiveJsonAsync();
        await h.Socket!.CloseAsync(WebSocketCloseStatus.NormalClosure, "test", default);
        await h.WaitForSocketCompletionAsync();

        var replacement = h.Tickets.Issue(501, 11, h.MatchId, RealtimeRole.Participant);
        using var socket = await h.ConnectAsync(replacement.Token);
        using var welcome = await h.ReceiveJsonAsync(socket);
        Assert.AreEqual(11, welcome.RootElement.GetProperty("sessionId").GetInt64());
    }

    [TestMethod]
    public async Task TerminalStateIsDeliveredBeforeTheCloseFrame()
    {
        await using var h = await RealtimeHarness.ConnectedParticipantAsync();
        _ = await h.ReceiveJsonAsync();
        _ = await h.ReceiveJsonAsync();
        await h.Coordinator.ForfeitAsync(h.MatchId, 502, "test");
        using var closed = await h.ReceiveJsonAsync();
        Assert.AreEqual("matchClosed", closed.RootElement.GetProperty("type").GetString());
        Assert.AreEqual(2, closed.RootElement.GetProperty("finalState").GetProperty("score")[0].GetInt32());
        Assert.AreEqual(WebSocketMessageType.Close, (await h.ReceiveRawAsync()).MessageType);
    }

    private sealed class RealtimeHarness : IAsyncDisposable
    {
        private readonly WebApplicationFactory<Program> _factory;

        private RealtimeHarness(WebApplicationFactory<Program> factory, ManualTimeProvider time,
            ContinuousGameCoordinator coordinator, RealtimeTicketStore tickets, long matchId)
        {
            _factory = factory; Time = time; Coordinator = coordinator; Tickets = tickets; MatchId = matchId;
        }

        public ManualTimeProvider Time { get; }
        public ContinuousGameCoordinator Coordinator { get; }
        public RealtimeTicketStore Tickets { get; }
        public long MatchId { get; }
        public WebSocket? Socket { get; private set; }

        public static async Task<RealtimeHarness> CreateAsync()
        {
            var time = new ManualTimeProvider();
            var coordinator = new ContinuousGameCoordinator([new TestDefinition()], time,
                new Sink(), new Publisher(), NullLogger<ContinuousGameCoordinator>.Instance);
            var factory = new BrmbleServerFactory().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["Games:RealtimeAllowedOrigins:0"] = "https://app.test" }));
                builder.ConfigureServices(services =>
                {
                    services.RemoveAll<ContinuousGameCoordinator>();
                    services.RemoveAll<TimeProvider>();
                    services.AddSingleton<TimeProvider>(time);
                    services.AddSingleton(coordinator);
                });
            });
            _ = factory.Services;
            var started = await coordinator.StartAsync(Reservation());
            Assert.IsTrue(started.Success, started.Error);
            return new RealtimeHarness(factory, time, coordinator,
                factory.Services.GetRequiredService<RealtimeTicketStore>(), started.MatchId);
        }

        public static async Task<RealtimeHarness> ConnectedParticipantAsync()
        {
            var h = await CreateAsync();
            var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
            h.Socket = await h.ConnectAsync(ticket.Token);
            return h;
        }

        public async Task<WebSocket> ConnectAsync(string token, string? origin = "https://app.test")
        {
            var client = _factory.Server.CreateWebSocketClient();
            if (origin is not null) client.ConfigureRequest = request => request.Headers.Origin = origin;
            return await client.ConnectAsync(new Uri($"ws://localhost/games/realtime?ticket={token}"), default);
        }

        public async Task AssertUpgradeRejectedAsync(string? token, string? origin = "https://app.test")
        {
            var uri = token is null ? "ws://localhost/games/realtime" : $"ws://localhost/games/realtime?ticket={token}";
            await AssertUpgradeRejectedUriAsync(uri, origin);
        }

        public async Task AssertUpgradeRejectedUriAsync(string uri, string? origin = "https://app.test")
        {
            var client = _factory.Server.CreateWebSocketClient();
            if (origin is not null) client.ConfigureRequest = request => request.Headers.Origin = origin;
            await Assert.ThrowsExceptionAsync<InvalidOperationException>(
                () => client.ConnectAsync(new Uri(uri), default));
        }

        public async Task SendTextAsync(string json) =>
            await Socket!.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, default);

        public async Task<JsonDocument> ReceiveJsonAsync(WebSocket? socket = null)
        {
            var result = await ReceiveRawAsync(socket);
            Assert.AreEqual(WebSocketMessageType.Text, result.MessageType);
            return JsonDocument.Parse(result.Payload);
        }

        public async Task<Received> ReceiveRawAsync(WebSocket? socket = null)
        {
            socket ??= Socket!;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var bytes = new byte[70_000];
            var result = await socket.ReceiveAsync(bytes, timeout.Token);
            return new Received(result.MessageType, result.CloseStatus, bytes[..result.Count]);
        }

        public async Task<Received> ReceiveCloseAsync()
        {
            for (var count = 0; count < 4; count++)
            {
                var received = await ReceiveRawAsync();
                if (received.MessageType == WebSocketMessageType.Close) return received;
            }
            Assert.Fail("Close frame was not received.");
            throw new InvalidOperationException();
        }

        public async Task WaitForSocketCompletionAsync()
        {
            await Task.Delay(50);
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                if (Socket is { State: WebSocketState.Open })
                    await Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test cleanup", default);
            }
            catch (IOException) { }
            Socket?.Dispose();
            await _factory.DisposeAsync();
        }

        private static DuelReservation Reservation() => new(9, 7,
            new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
            new DuelConfiguration("endpoint-test", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
            DateTimeOffset.UnixEpoch, 1, null);
    }

    private sealed record Received(WebSocketMessageType MessageType, WebSocketCloseStatus? CloseStatus, byte[] Payload);

    private sealed class TestDefinition : IContinuousGameDefinition
    {
        public string GameType => "endpoint-test";
        public int RulesetVersion => 1;
        public object PredictionConstants => new
        {
            unitsPerWorldUnit = 1000, playerRadius = 600, baseMovePerTick = 90, chargedMovePerTick = 45,
            momentumRetentionPermille = 920, chargeTicks = 90, forcedFireTicks = 30, shotCooldownTicks = 24,
            projectileRadius = 180, projectilePerTick = 240, projectileBaseKnockback = 130,
            projectileBonusKnockback = 220, recoilBase = 45, recoilBonus = 105, dashTicks = 6, dashPerTick = 240,
        };
        public IContinuousSimulation Create(DuelReservation reservation) => new TestSimulation();
    }

    private sealed class TestSimulation : IContinuousSimulation
    {
        public long Tick => 0;
        public ContinuousMatchPhase Phase => ContinuousMatchPhase.AwaitingParticipants;
        public void SetInput(long sessionId, ContinuousInput input) { }
        public void SetNeutralInput(long sessionId) { }
        public ContinuousStepResult Step() => new(false, null);
        public object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs) => new
        {
            phase = "ended", phaseEndsAtTick = (long?)null, score = new[] { 2, 0 }, consecutiveDoubleKos = 0,
            arena = new { radius = 0, shrinkPhase = "collapse" }, players = Array.Empty<object>(), projectiles = Array.Empty<object>(),
        };
        public object SpectatorSnapshot() => ParticipantSnapshot(0, new Dictionary<long, long>());
        public ulong DeterministicHash() => 0;
    }

    private sealed class Sink : ICompletedMatchSink { public void Enqueue(CompletedMatch match) { } }
    private sealed class Publisher : IGameEventPublisher
    {
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private readonly List<ManualTimer> _timers = [];
        private DateTimeOffset _now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => _now;
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(this, callback, state, dueTime, period);
            _timers.Add(timer);
            return timer;
        }
        public void Advance(TimeSpan by)
        {
            _now += by;
            foreach (var timer in _timers.ToArray()) timer.FireIfDue();
        }

        private sealed class ManualTimer : ITimer
        {
            private readonly ManualTimeProvider _owner;
            private readonly TimerCallback _callback;
            private readonly object? _state;
            private DateTimeOffset _dueAt;
            private TimeSpan _period;
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
                _dueAt = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : _owner._now + dueTime;
                _period = period;
                return true;
            }
            public void FireIfDue()
            {
                while (!_disposed && _owner._now >= _dueAt)
                {
                    _dueAt = _period == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : _dueAt + _period;
                    _callback(_state);
                }
            }
            public void Dispose() => _disposed = true;
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }
}
