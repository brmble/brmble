using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Games;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Brmble.Server.Tests.Integration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
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
        CollectionAssert.AreEquivalent(new[]
        {
            "type", "protocolVersion", "rulesetVersion", "matchId", "role", "sessionId",
            "snapshotSequence", "serverTick", "tickRate", "snapshotRate", "interpolationMs",
            "maxExtrapolationMs", "inputHeartbeatMs", "neutralAfterMs", "reconnectGraceMs",
            "prediction", "state", "acknowledgedInput",
        }, root.EnumerateObject().Select(x => x.Name).ToArray());
        CollectionAssert.AreEquivalent(new[]
        {
            "unitsPerWorldUnit", "playerRadius", "baseMovePerTick", "chargedMovePerTick",
            "momentumRetentionPermille", "chargeTicks", "forcedFireTicks", "shotCooldownTicks",
            "projectileRadius", "projectilePerTick", "projectileBaseKnockback",
            "projectileBonusKnockback", "recoilBase", "recoilBonus", "dashTicks", "dashPerTick",
        }, root.GetProperty("prediction").EnumerateObject().Select(x => x.Name).ToArray());
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
    public async Task SpectatorTicketReturnsExactWrongRoleResponseWithoutAttach()
    {
        await using var h = await RealtimeHarness.CreateAsync();
        var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Spectator);

        var response = await h.InvokeDirectAsync(ticket.Token);

        Assert.AreEqual(StatusCodes.Status403Forbidden, response.StatusCode);
        Assert.AreEqual("{\"error\":\"wrongRole\"}", response.Body);
        Assert.AreEqual(0, h.DetachCount);
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
    public async Task MatchEndingAfterConsumptionIsRejectedBeforeUpgradeAndTicketCannotRetry()
    {
        var consumed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var h = await RealtimeHarness.CreateAsync(async _ =>
        {
            consumed.TrySetResult();
            await release.Task;
        });
        var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        var connecting = h.ConnectAttemptAsync(ticket.Token);
        await consumed.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test");
        release.TrySetResult();

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => connecting);
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
        await h.Detached.Task.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.AreEqual(1, h.DetachCount);

        var replacement = h.Tickets.Issue(501, 11, h.MatchId, RealtimeRole.Participant);
        using var socket = await h.ConnectAsync(replacement.Token);
        using var welcome = await h.ReceiveJsonAsync(socket);
        Assert.AreEqual(11, welcome.RootElement.GetProperty("sessionId").GetInt64());
    }

    [TestMethod]
    public async Task SplitMultibyteUtf8AndMalformedUtf8AreRejectedWithoutDecoderCorruption()
    {
        await using (var h = await RealtimeHarness.ConnectedParticipantAsync())
        {
            _ = await h.ReceiveJsonAsync();
            var payload = Encoding.UTF8.GetBytes($"{{\"type\":\"heartbéat\",\"protocolVersion\":1,\"matchId\":{h.MatchId}}}");
            var split = Array.IndexOf(payload, (byte)0xC3) + 1;
            await h.Socket!.SendAsync(payload.AsMemory(0, split), WebSocketMessageType.Text, false, default);
            await h.Socket.SendAsync(payload.AsMemory(split), WebSocketMessageType.Text, true, default);
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }

        await using (var h = await RealtimeHarness.ConnectedParticipantAsync())
        {
            _ = await h.ReceiveJsonAsync();
            await h.Socket!.SendAsync(new byte[] { (byte)'{', (byte)'\"', 0xC3, (byte)'\"', (byte)'}' },
                WebSocketMessageType.Text, true, default);
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }
    }

    [TestMethod]
    public async Task MissingAndExtraPayloadFieldsAreRejected()
    {
        foreach (var payload in new[]
        {
            "{\"type\":\"attachAck\",\"protocolVersion\":1,\"matchId\":1}",
            "{\"type\":\"attachAck\",\"protocolVersion\":1,\"matchId\":1,\"snapshotSequence\":1,\"extra\":true}",
            "{\"type\":\"heartbeat\",\"protocolVersion\":1,\"matchId\":1,\"sequence\":1,\"predictedTick\":0,\"moveX\":0,\"moveY\":0,\"aimX\":1,\"aimY\":0}",
        })
        {
            await using var h = await RealtimeHarness.ConnectedParticipantAsync();
            _ = await h.ReceiveJsonAsync();
            await h.SendTextAsync(payload.Replace("\"matchId\":1", $"\"matchId\":{h.MatchId}"));
            Assert.AreEqual(WebSocketCloseStatus.InvalidPayloadData, (await h.ReceiveCloseAsync()).CloseStatus);
        }
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

    [TestMethod]
    public async Task QueuedTerminalInterruptsBlockedOrdinarySendAndIsSentNext()
    {
        var mailbox = new RealtimeSnapshotMailbox();
        mailbox.ReplaceSnapshot("{\"type\":\"snapshot\"}");
        var socket = new BlockingWebSocket(blockTerminal: false);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var sending = RealtimeGameEndpoint.SendLoopAsync(socket, mailbox, cancellation.Token);
        await socket.OrdinarySendStarted.Task.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.IsTrue(mailbox.SealTerminal(new RealtimeControl(
            "matchClosed", null, 2, "{\"type\":\"matchClosed\"}", false)));

        Assert.AreEqual(RealtimeGameEndpoint.LoopOutcome.Terminal,
            await sending.WaitAsync(TimeSpan.FromSeconds(1)));
        CollectionAssert.AreEqual(new[] { "matchClosed" }, socket.CompletedTypes.ToArray());
        Assert.AreEqual(1, socket.MaxConcurrentSends);
    }

    [TestMethod]
    public async Task FullMailboxOverloadInterruptsBlockedOrdinarySendPromptly()
    {
        var mailbox = new RealtimeSnapshotMailbox();
        mailbox.ReplaceSnapshot("{\"type\":\"snapshot\"}");
        var socket = new BlockingWebSocket(blockTerminal: false);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var sending = RealtimeGameEndpoint.SendLoopAsync(socket, mailbox, cancellation.Token);
        await socket.OrdinarySendStarted.Task.WaitAsync(TimeSpan.FromSeconds(1));
        for (var i = 0; i < 14; i++) mailbox.WriteControl(new RealtimeControl(
            "connectionState", i, null, "{}", true));
        mailbox.WriteControl(new RealtimeControl("welcome", null, null, "{}", false));
        mailbox.WriteControl(new RealtimeControl("matchClosed", null, 1, "{}", false));

        Assert.IsFalse(mailbox.SealTerminal(new RealtimeControl("matchClosed", null, 2, "{}", false)));

        Assert.AreEqual(RealtimeGameEndpoint.LoopOutcome.Overloaded,
            await sending.WaitAsync(TimeSpan.FromSeconds(1)));
        Assert.AreEqual(0, socket.CompletedTypes.Count);
    }

    [TestMethod]
    public async Task TerminalSendTimeoutReturnsControlledOutcomeWithoutLeakingCancellation()
    {
        var mailbox = new RealtimeSnapshotMailbox();
        Assert.IsTrue(mailbox.SealTerminal(new RealtimeControl(
            "matchClosed", null, 2, "{\"type\":\"matchClosed\"}", false)));
        var socket = new BlockingWebSocket(blockTerminal: true);

        var outcome = await RealtimeGameEndpoint.SendLoopAsync(socket, mailbox, default)
            .WaitAsync(TimeSpan.FromSeconds(3));

        Assert.AreEqual(RealtimeGameEndpoint.LoopOutcome.TerminalTimedOut, outcome);
        Assert.AreEqual(0, socket.CompletedTypes.Count);
    }

    [TestMethod]
    public async Task TerminalTimeoutUsesBoundedControlledAbnormalClose()
    {
        var socket = new BlockingWebSocket(blockTerminal: false, blockClose: true);

        await RealtimeGameEndpoint.CloseOutputBoundedAsync(
            socket, WebSocketCloseStatus.EndpointUnavailable, "terminal timeout", TimeSpan.FromMilliseconds(25));

        Assert.IsTrue(socket.CloseCancellationObserved);
        Assert.AreEqual(WebSocketCloseStatus.EndpointUnavailable, socket.RequestedCloseStatus);
    }

    [TestMethod]
    public async Task SlowSocketReaderReceivesLatestSnapshotRatherThanBacklog()
    {
        await using var h = await RealtimeHarness.CreateAsync(afterAttach: mailbox =>
        {
            for (var i = 1; i <= 20; i++)
                mailbox.ReplaceSnapshot($"{{\"type\":\"snapshot\",\"sequence\":{i}}}");
        });
        var ticket = h.Tickets.Issue(501, 10, h.MatchId, RealtimeRole.Participant);
        h.Socket = await h.ConnectAsync(ticket.Token);

        _ = await h.ReceiveJsonAsync();
        using var snapshot = await h.ReceiveJsonAsync();

        Assert.AreEqual("snapshot", snapshot.RootElement.GetProperty("type").GetString());
        Assert.AreEqual(20, snapshot.RootElement.GetProperty("sequence").GetInt32());
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
        public WebSocket? Socket { get; set; }
        public int DetachCount { get; private set; }
        public TaskCompletionSource Detached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public static async Task<RealtimeHarness> CreateAsync(
            Func<TicketScope, Task>? beforeRevalidate = null,
            Action<RealtimeSnapshotMailbox>? afterAttach = null)
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
                    if (beforeRevalidate is not null || afterAttach is not null)
                        services.AddSingleton(new RealtimeGameEndpointHooks
                        {
                            BeforeRevalidateAsync = beforeRevalidate,
                            AfterAttach = afterAttach,
                        });
                });
            });
            _ = factory.Services;
            var started = await coordinator.StartAsync(Reservation());
            Assert.IsTrue(started.Success, started.Error);
            var harness = new RealtimeHarness(factory, time, coordinator,
                factory.Services.GetRequiredService<RealtimeTicketStore>(), started.MatchId);
            coordinator.ParticipantDetached += _ =>
            {
                harness.DetachCount++;
                harness.Detached.TrySetResult();
            };
            return harness;
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

        public Task<WebSocket> ConnectAttemptAsync(string token) => ConnectAsync(token);

        public async Task<(int StatusCode, string Body)> InvokeDirectAsync(string token)
        {
            var context = new DefaultHttpContext { RequestServices = _factory.Services };
            context.Request.Method = HttpMethods.Get;
            context.Request.QueryString = new QueryString($"?ticket={token}");
            context.Request.Headers.Origin = "https://app.test";
            context.Response.Body = new MemoryStream();
            context.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpWebSocketFeature>(
                new RequestOnlyWebSocketFeature());
            await RealtimeGameEndpoint.HandleAsync(context);
            context.Response.Body.Position = 0;
            return (context.Response.StatusCode, await new StreamReader(context.Response.Body).ReadToEndAsync());
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

    private sealed class RequestOnlyWebSocketFeature : Microsoft.AspNetCore.Http.Features.IHttpWebSocketFeature
    {
        public bool IsWebSocketRequest => true;
        public Task<WebSocket> AcceptAsync(WebSocketAcceptContext context) =>
            throw new AssertFailedException("Spectator request must not upgrade.");
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

    private sealed class BlockingWebSocket(
        bool blockTerminal, bool blockClose = false) : WebSocket
    {
        private int _activeSends;
        public TaskCompletionSource OrdinarySendStarted { get; } = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        public List<string> CompletedTypes { get; } = [];
        public int MaxConcurrentSends { get; private set; }
        public bool CloseCancellationObserved { get; private set; }
        public WebSocketCloseStatus? RequestedCloseStatus { get; private set; }
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => WebSocketState.Open;
        public override string? SubProtocol => null;
        public override void Abort() { }
        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription,
            CancellationToken cancellationToken) => Task.CompletedTask;
        public override async Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription,
            CancellationToken cancellationToken)
        {
            RequestedCloseStatus = closeStatus;
            if (!blockClose) return;
            try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                CloseCancellationObserved = true;
                throw;
            }
        }
        public override void Dispose() { }
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer,
            CancellationToken cancellationToken) => throw new NotSupportedException();
        public override async Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType,
            bool endOfMessage, CancellationToken cancellationToken)
        {
            var active = Interlocked.Increment(ref _activeSends);
            MaxConcurrentSends = Math.Max(MaxConcurrentSends, active);
            try
            {
                using var json = JsonDocument.Parse(buffer);
                var type = json.RootElement.GetProperty("type").GetString()!;
                if (type != "matchClosed") OrdinarySendStarted.TrySetResult();
                if (type != "matchClosed" || blockTerminal)
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                CompletedTypes.Add(type);
            }
            finally
            {
                Interlocked.Decrement(ref _activeSends);
            }
        }
    }
}
