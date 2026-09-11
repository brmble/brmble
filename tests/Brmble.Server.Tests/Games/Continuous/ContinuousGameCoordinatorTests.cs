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
    public async Task ReconnectWireProjectionUsesCurrentSessionIdsEverywhere()
    {
        var h = await Harness.LiveAsync();
        while (h.Simulation.Phase != ContinuousMatchPhase.Live) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(1, h.Simulation.Tick, 0, 0, 32767, 0, true, false, false));
        // Charge past the minimum: these pin reconnect projection, not the charge gate.
        for (var charge = 0; charge < ArenaRulesetV1.MinChargeTicks; charge++) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(2, h.Simulation.Tick, 0, 0, 32767, 0, false, true, false));
        h.Simulation.Step();
        Assert.IsTrue(h.Simulation.Projectiles.Any(x => x.OwnerSessionId == 10));
        await h.Coordinator.DetachAsync("one");

        var replacement = await h.AttachAsync(501, 11, "replacement");
        var welcome = await h.Mailboxes[11].ReadNextAsync(default);
        var snapshot = await h.Mailboxes[11].ReadNextAsync(default);

        Assert.AreEqual(11, replacement.Welcome!.SessionId);
        AssertCurrentWireIds(welcome.Json, expectedPlayer: 11, forbiddenPlayer: 10);
        AssertCurrentWireIds(snapshot.Json, expectedPlayer: 11, forbiddenPlayer: 10);
        using var snapshotJson = JsonDocument.Parse(snapshot.Json);
        Assert.AreEqual(11, snapshotJson.RootElement.GetProperty("projectiles")[0]
            .GetProperty("ownerSessionId").GetInt64());
    }

    [TestMethod]
    public async Task DetachedAndReplacementPreAckInputsCannotAdvanceAcknowledgement()
    {
        var h = await Harness.LiveAsync();
        await h.Coordinator.DetachAsync("one");

        Assert.IsFalse(h.Submit(10, 1).Accepted);
        var replacement = await h.AttachAsync(501, 11, "replacement");
        Assert.IsFalse(h.Submit(10, 1).Accepted);
        Assert.IsFalse(h.Submit(11, 1).Accepted);
        Assert.AreEqual(0, replacement.Welcome!.AcknowledgedInput);

        h.Coordinator.AcknowledgeAttach("replacement", replacement.Welcome.SnapshotSequence);
        Assert.IsTrue(h.Submit(11, 1).Accepted);
    }

    [TestMethod]
    public async Task UnacknowledgedReconnectKeepsAttachSnapshotWhileSimulationAdvances()
    {
        var h = await Harness.LiveAsync();
        await h.Coordinator.DetachAsync("one");
        var replacement = await h.AttachAsync(501, 11, "replacement");
        var expectedSequence = replacement.Welcome!.SnapshotSequence;
        var before = h.Simulation.Tick;

        h.Time.Advance(TimeSpan.FromSeconds(1));
        await WaitUntilAsync(() => h.Simulation.Tick > before);
        _ = await h.Mailboxes[11].ReadNextAsync(default);
        var snapshot = await h.Mailboxes[11].ReadNextAsync(default);

        using var json = JsonDocument.Parse(snapshot.Json);
        Assert.AreEqual(expectedSequence, json.RootElement.GetProperty("sequence").GetInt64());
        Assert.IsTrue(h.Simulation.Tick > before);
    }

    [TestMethod]
    public async Task ReattachRejectsOpponentSessionWithoutMutatingEitherMapping()
    {
        var h = await Harness.LiveAsync();
        while (h.Simulation.Phase != ContinuousMatchPhase.Live) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(1, h.Simulation.Tick, 0, 0, 32767, 0, true, false, false));
        // Charge past the minimum: these pin reconnect projection, not the charge gate.
        for (var charge = 0; charge < ArenaRulesetV1.MinChargeTicks; charge++) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(2, h.Simulation.Tick, 0, 0, 32767, 0, false, true, false));
        h.Simulation.Step();
        await h.Coordinator.DetachAsync("one");

        var collision = await h.Coordinator.AttachParticipantAsync(
            h.MatchId, 501, 20, "collision", new RealtimeSnapshotMailbox());

        Assert.IsFalse(collision.Ok);
        Assert.IsTrue(h.Submit(20, 1).Accepted);
        var replacement = await h.AttachAsync(501, 11, "replacement", acknowledge: true);
        var snapshot = await h.Mailboxes[11].ReadNextAsync(default);
        snapshot = await h.Mailboxes[11].ReadNextAsync(default);
        using var json = JsonDocument.Parse(snapshot.Json);
        var ids = json.RootElement.GetProperty("players").EnumerateArray()
            .Select(x => x.GetProperty("sessionId").GetInt64()).ToArray();
        CollectionAssert.AreEquivalent(new long[] { 11, 20 }, ids);
        Assert.AreEqual(2, ids.Distinct().Count());
        var owners = json.RootElement.GetProperty("projectiles").EnumerateArray()
            .Select(x => x.GetProperty("ownerSessionId").GetInt64()).ToArray();
        Assert.IsTrue(owners.Length > 0);
        Assert.IsTrue(owners.All(ids.Contains));
        Assert.AreEqual(11, replacement.Welcome!.SessionId);
    }

    [TestMethod]
    public async Task MatchingReconnectAckResumesCadenceAtNextSequence()
    {
        var h = await Harness.LiveAsync();
        await h.Coordinator.DetachAsync("one");
        var replacement = await h.AttachAsync(501, 11, "replacement");
        await DrainInitialAttachAsync(h.Mailboxes[11]);
        h.Coordinator.AcknowledgeAttach("replacement", replacement.Welcome!.SnapshotSequence);

        h.Time.Advance(TimeSpan.FromMilliseconds(100));
        await WaitUntilAsync(() => h.Simulation.Tick > replacement.Welcome.ServerTick);
        var cadence = await h.Mailboxes[11].ReadNextAsync(default);

        using var json = JsonDocument.Parse(cadence.Json);
        Assert.AreEqual("snapshot", cadence.Type);
        Assert.IsTrue(json.RootElement.GetProperty("sequence").GetInt64()
            > replacement.Welcome.SnapshotSequence);
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

        // The client seeds its server-clock offset from the welcome and then samples a
        // timeline whose first entry is this very snapshot. Stamp the two from different
        // instants and the seed disagrees with the frame it is supposed to place, which
        // is the same class of defect as having no offset at all. They are taken from one
        // `attachedAt` for exactly this reason.
        Assert.IsTrue(welcomeJson.RootElement.TryGetProperty("generatedAtUnixMs", out var welcomeStamp));
        Assert.AreEqual(
            welcomeStamp.GetInt64(),
            snapshotJson.RootElement.GetProperty("generatedAtUnixMs").GetInt64(),
            "Welcome and its attach snapshot must describe the same instant.");
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
    public async Task CompletionAttemptsActuallyOverlapWhileFirstSinkIsBlocked()
    {
        var sink = new BlockingSink();
        var h = await ControlledHarness.StartAsync(new FaultSimulation(), sink);
        await h.AttachBothAsync();

        var first = Task.Run(() => h.Coordinator.ForfeitAsync(h.MatchId, 501, "first"));
        Assert.IsTrue(sink.Entered.Wait(TimeSpan.FromSeconds(2)));
        var second = Task.Run(() => h.Coordinator.ForfeitAsync(h.MatchId, 502, "second"));
        await second.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.IsFalse(first.IsCompleted);
        sink.Release.Set();
        await first.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.AreEqual(1, sink.Count);
        Assert.AreEqual(1, h.MatchCompletedCount);
    }

    [TestMethod]
    public async Task AttachAndCompletionActuallyContendForMatchLock()
    {
        var simulation = new BlockingProjectionSimulation();
        var h = await ControlledHarness.StartAsync(simulation, new RecordingSink());
        var mailbox = new RealtimeSnapshotMailbox();

        var attach = Task.Run(() => h.Coordinator.AttachParticipantAsync(
            h.MatchId, 501, 10, "one", mailbox));
        Assert.IsTrue(simulation.ProjectionEntered.Wait(TimeSpan.FromSeconds(2)));
        var completion = Task.Run(() => h.Coordinator.ForfeitAsync(h.MatchId, 502, "race"));
        await Task.Delay(25);
        Assert.IsFalse(completion.IsCompleted);
        simulation.ReleaseProjection.Set();
        var result = await attach.WaitAsync(TimeSpan.FromSeconds(2));
        await completion.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.IsTrue(result.Ok);
        Assert.AreEqual("matchClosed", await DrainThroughTerminalAsync(mailbox));
        await AssertMailboxEmptyAsync(mailbox);
        Assert.AreEqual(1, h.MatchCompletedCount);
    }

    [TestMethod]
    public async Task SinkFailureStillReleasesOwnershipRaisesCompletionAndPublishesEnded()
    {
        var h = await Harness.LiveAsync(throwingSink: true);

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "failure_test");

        Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
        Assert.AreEqual(1, h.MatchCompletedCount);
        Assert.AreEqual(1, h.Publisher.Types.Count(x => x == "game.ended"));
    }

    [TestMethod]
    public async Task MatchClosedSealsMailboxAndNoSnapshotOrControlCanFollowIt()
    {
        var mailbox = new RealtimeSnapshotMailbox();
        mailbox.ReplaceSnapshot("{\"sequence\":1}");
        mailbox.SealTerminal(new RealtimeControl("matchClosed", null, 2, "{}", false));
        mailbox.ReplaceSnapshot("{\"sequence\":3}");
        mailbox.WriteControl(new RealtimeControl("connectionState", 10, null, "{}", true));

        Assert.AreEqual("matchClosed", (await mailbox.ReadNextAsync(default)).Type);
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));
        await Assert.ThrowsExceptionAsync<OperationCanceledException>(async () =>
            await mailbox.ReadNextAsync(timeout.Token));
    }

    [TestMethod]
    public async Task AttachRacingCompletionNeverWritesAfterTerminal()
    {
        for (var iteration = 0; iteration < 25; iteration++)
        {
            var h = await Harness.LiveAsync();
            await h.Coordinator.DetachAsync("one");
            var mailbox = new RealtimeSnapshotMailbox();

            var attachTask = h.Coordinator.AttachParticipantAsync(h.MatchId, 501, 11, "replacement", mailbox);
            var completionTask = h.Coordinator.ForfeitAsync(h.MatchId, 502, "race");
            await Task.WhenAll(attachTask, completionTask);

            if (attachTask.Result.Ok)
            {
                Assert.AreEqual("matchClosed", await DrainThroughTerminalAsync(mailbox));
                await AssertMailboxEmptyAsync(mailbox);
            }
            else
            {
                Assert.IsNull(attachTask.Result.Welcome);
            }
        }
    }

    [TestMethod]
    public async Task ReconnectFinalStateUsesCurrentSessionAndProjectileOwnerIds()
    {
        var h = await Harness.LiveAsync();
        while (h.Simulation.Phase != ContinuousMatchPhase.Live) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(1, h.Simulation.Tick, 0, 0, 32767, 0, true, false, false));
        // Charge past the minimum: these pin reconnect projection, not the charge gate.
        for (var charge = 0; charge < ArenaRulesetV1.MinChargeTicks; charge++) h.Simulation.Step();
        h.Simulation.SetInput(10, new ContinuousInput(2, h.Simulation.Tick, 0, 0, 32767, 0, false, true, false));
        h.Simulation.Step();
        await h.Coordinator.DetachAsync("one");
        var replacement = await h.AttachAsync(501, 11, "replacement", acknowledge: true);

        await h.Coordinator.ForfeitAsync(h.MatchId, 502, "wire_test");
        var terminal = await ReadTerminalAsync(h.Mailboxes[11]);

        AssertCurrentWireIds(terminal.Json, expectedPlayer: 11, forbiddenPlayer: 10);
        using var json = JsonDocument.Parse(terminal.Json);
        Assert.AreEqual(11, json.RootElement.GetProperty("finalState").GetProperty("projectiles")[0]
            .GetProperty("ownerSessionId").GetInt64());
        Assert.AreEqual(replacement.Welcome!.AcknowledgedInput,
            json.RootElement.GetProperty("finalState").GetProperty("players").EnumerateArray()
                .Single(x => x.GetProperty("sessionId").GetInt64() == 11)
            .GetProperty("acknowledgedInput").GetInt64());
    }

    [TestMethod]
    public async Task SchedulerFaultCompletesAndReleasesOwnership()
    {
        var h = await FaultHarness.StartAsync(new FaultSimulation(throwOnStep: true));
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitUntilAsync(() => !h.Coordinator.TryGetActiveMatch(501, out _));
        // Ownership is released before the subscribers run, so wait for the publish that
        // ends CompleteAsync before asserting on anything downstream of it.
        await WaitForGameEndedAsync(h.Publisher);

        Assert.AreEqual("scheduler_error", h.Sink.Match!.AbandonReason);
        Assert.AreEqual(1, h.MatchCompletedCount);
        await WaitUntilAsync(() => h.Time.AllTimersDisposed);
    }

    [TestMethod]
    public async Task FinalProjectionFaultStillReleasesOwnershipAndAttemptsCompletionStages()
    {
        var simulation = new FaultSimulation(throwAfterSnapshotCount: 2);
        var h = await FaultHarness.StartAsync(simulation);
        await h.AttachBothAsync();

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "projection_test");

        Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
        Assert.AreEqual(1, h.MatchCompletedCount);
        Assert.AreEqual(1, h.Sink.Count);
        Assert.AreEqual(1, h.Publisher.Types.Count(x => x == "game.ended"));
    }

    [TestMethod]
    public async Task NaturalSimulationCompletionPersistsThenRaisesAndPublishesEnded()
    {
        var simulation = new FaultSimulation(completeOnStep: true);
        var h = await FaultHarness.StartAsync(simulation);
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitUntilAsync(() => h.MatchCompletedCount == 1);
        await WaitForGameEndedAsync(h.Publisher);

        Assert.AreEqual("decided", h.Sink.Match!.Outcome);
        Assert.IsNull(h.Sink.Match.AbandonReason);
        CollectionAssert.AreEquivalent(new long[] { 501, 502 },
            h.Sink.Match.Participants.Select(x => x.UserId).ToArray());
        Assert.AreEqual(1, h.Publisher.Types.Count(x => x == "game.ended"));
    }

    [TestMethod]
    public async Task ForfeitPublishesTheOtherParticipantsSessionIdAsWinner()
    {
        var h = await Harness.LiveAsync();

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test_forfeit");

        // 501 forfeited, so 502 wins; winnerId is 502's Mumble SESSION id (20).
        Assert.AreEqual(20, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task ForfeitByTheOtherParticipantPublishesTheOppositeWinnerSessionId()
    {
        var h = await Harness.LiveAsync();

        await h.Coordinator.ForfeitAsync(h.MatchId, 502, "test_forfeit");

        Assert.AreEqual(10, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task ForfeitWinnerIdUsesTheWinnersCurrentSessionAfterReconnect()
    {
        var h = await Harness.LiveAsync();
        await h.Coordinator.DetachAsync("two");
        await h.AttachAsync(502, 21, "twoAgain", acknowledge: true);

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test_forfeit");

        Assert.AreEqual(21, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task NaturalCompletionPublishesTheWinningParticipantsSessionId()
    {
        var h = await FaultHarness.StartAsync(new FaultSimulation(completeOnStep: true));
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitForGameEndedAsync(h.Publisher);

        // The completion names stable user 501 as the winner; the wire carries session 10.
        Assert.AreEqual(10, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task DrawCompletionPublishesANullWinnerRatherThanInventingOne()
    {
        var h = await FaultHarness.StartAsync(new FaultSimulation(drawOnStep: true));
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitForGameEndedAsync(h.Publisher);

        var ended = h.Publisher.GameEnded();
        Assert.IsTrue(ended.TryGetProperty("winnerId", out var winner));
        Assert.AreEqual(JsonValueKind.Null, winner.ValueKind);
    }

    [TestMethod]
    public async Task CompletionNamingAnUnknownWinnerPublishesANullWinnerAndStillEnds()
    {
        var h = await FaultHarness.StartAsync(new FaultSimulation(unknownWinnerOnStep: true));
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitForGameEndedAsync(h.Publisher);

        var ended = h.Publisher.GameEnded();
        Assert.AreEqual(JsonValueKind.Null, ended.GetProperty("winnerId").ValueKind);
        Assert.AreEqual(1, h.Publisher.Types.Count(x => x == "game.ended"));
    }

    [TestMethod]
    public async Task NaturalCompletionWinnerIdUsesTheWinnersCurrentSessionAfterReconnect()
    {
        // Pins the completion path's own session translation. The other completion test
        // cannot: there session id and simulation session id are both 10.
        var h = await FaultHarness.StartAsync(new FaultSimulation(completeOnStep: true, winnerUserId: 502));
        await h.AttachAsync(501, 10, "one");
        // Reattach before the final ack, because that ack starts the scheduler and this
        // simulation completes on its very first step.
        await h.AttachAsync(502, 20, "two", acknowledge: false);
        await h.Coordinator.DetachAsync("two");
        await h.AttachAsync(502, 21, "twoAgain");

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitForGameEndedAsync(h.Publisher);

        // 502's simulation session is still 20; only the current session is 21.
        Assert.AreEqual(21, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task ServerFaultAbandonsPublishNoWinnerSoNeitherPlayerIsVanished()
    {
        // scheduler_error blames PlayerOne by convention for a fault neither player
        // caused; naming a winner would animate PlayerOne as the loser.
        var h = await FaultHarness.StartAsync(new FaultSimulation(throwOnStep: true));
        await h.AttachBothAsync();

        h.Time.Advance(TimeSpan.FromMilliseconds(20));
        await WaitUntilAsync(() => !h.Coordinator.TryGetActiveMatch(501, out _));
        // Ownership is released before the publish, so that alone is not enough.
        await WaitForGameEndedAsync(h.Publisher);

        Assert.AreEqual("scheduler_error", h.Sink.Match!.AbandonReason);
        var ended = h.Publisher.GameEnded();
        Assert.AreEqual(JsonValueKind.Null, ended.GetProperty("winnerId").ValueKind);
        // The persisted record keeps its existing convention: the fix is wire-only.
        Assert.AreEqual(502, h.Sink.Match.Participants.Single(x => x.Result == "win").UserId);
    }

    [TestMethod]
    public async Task ParticipantCausedAbandonsStillNameAWinner()
    {
        // Guards the fix from over-reaching: connection_timeout does blame a real player.
        var h = await Harness.StartAsync();
        await h.AttachAsync(501, 10, "one", acknowledge: true);

        h.Time.Advance(TimeSpan.FromSeconds(15));
        await WaitForGameEndedAsync(h.Publisher);

        Assert.AreEqual("connection_timeout", h.Sink.Match!.AbandonReason);
        Assert.AreEqual(10, h.Publisher.GameEnded().GetProperty("winnerId").GetInt64());
    }

    [TestMethod]
    public async Task SchedulerSnapshotsOnlyUseEveryThirdSimulationTick()
    {
        var h = await Harness.LiveAsync();
        await DrainInitialAttachAsync(h.Mailboxes[10]);
        var before = h.Simulation.Tick;

        await Task.Delay(25);
        h.Time.Advance(TimeSpan.FromMilliseconds(100));
        await WaitUntilAsync(() => h.Simulation.Tick >= before + 3);
        var snapshot = await h.Mailboxes[10].ReadNextAsync(default);

        using var json = JsonDocument.Parse(snapshot.Json);
        Assert.AreEqual("snapshot", snapshot.Type);
        Assert.AreEqual(0, json.RootElement.GetProperty("serverTick").GetInt64() % 3);
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

        public static Task<Harness> CreateAsync(bool throwingSink = false)
        {
            var time = new ManualTimeProvider();
            var definition = new CapturingDefinition();
            var sink = new RecordingSink(throwingSink);
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

        public static async Task<Harness> LiveAsync(bool throwingSink = false)
        {
            var h = throwingSink ? await CreateAsync(throwingSink: true) : await StartAsync();
            if (throwingSink)
            {
                var result = await h.Coordinator.StartAsync(Reservation());
                Assert.IsTrue(result.Success, result.Error);
                h.MatchId = result.MatchId;
                h.Coordinator.MatchCompleted += _ => { h.MatchCompletedCount++; return Task.CompletedTask; };
            }
            await h.AttachAsync(501, 10, "one", acknowledge: true);
            await h.AttachAsync(502, 20, "two", acknowledge: true);
            Assert.AreEqual(ContinuousMatchPhase.Loading, h.Simulation.Phase);
            return h;
        }

        public InputResult Submit(long sessionId, long sequence) => Coordinator.SubmitInput(
            MatchId, sessionId, RealtimeRole.Participant,
            new ContinuousInput(sequence, Simulation.Tick, 0, 0, 32767, 0, false, false, false), false);

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

    private static async Task<RealtimeOutbound> ReadTerminalAsync(RealtimeSnapshotMailbox mailbox)
    {
        for (var count = 0; count < 4; count++)
        {
            var message = await mailbox.ReadNextAsync(default);
            if (message.Type == "matchClosed") return message;
        }
        Assert.Fail("Terminal message was not found.");
        throw new InvalidOperationException();
    }

    private static async Task<string> DrainThroughTerminalAsync(RealtimeSnapshotMailbox mailbox) =>
        (await ReadTerminalAsync(mailbox)).Type;

    private static async Task AssertMailboxEmptyAsync(RealtimeSnapshotMailbox mailbox)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));
        await Assert.ThrowsExceptionAsync<OperationCanceledException>(async () =>
            await mailbox.ReadNextAsync(timeout.Token));
    }

    private static async Task DrainInitialAttachAsync(RealtimeSnapshotMailbox mailbox)
    {
        _ = await mailbox.ReadNextAsync(default);
        _ = await mailbox.ReadNextAsync(default);
    }

    private static void AssertCurrentWireIds(string json, long expectedPlayer, long forbiddenPlayer)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.TryGetProperty("state", out var state)) root = state;
        if (root.TryGetProperty("finalState", out var finalState)) root = finalState;
        var ids = root.GetProperty("players").EnumerateArray()
            .Select(x => x.GetProperty("sessionId").GetInt64()).ToArray();
        CollectionAssert.Contains(ids, expectedPlayer);
        CollectionAssert.DoesNotContain(ids, forbiddenPlayer);
        Assert.IsTrue(root.GetProperty("players").EnumerateArray()
            .Single(x => x.GetProperty("sessionId").GetInt64() == expectedPlayer)
            .TryGetProperty("acknowledgedInput", out _));
    }

    /// <summary>
    /// Waits against a deadline rather than a spin count. Completion runs on the
    /// coordinator's own scheduler thread, so how many yields it takes to get there is
    /// thread-pool scheduling luck, not a property of the code under test: a bounded
    /// <see cref="Task.Yield"/> loop passes on an idle machine and expires on a loaded one.
    /// </summary>
    private static async Task WaitUntilAsync(Func<bool> condition, string because = "Condition was not reached.")
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (!condition() && DateTime.UtcNow < deadline) await Task.Delay(5);
        Assert.IsTrue(condition(), because);
    }

    /// <summary>
    /// Waits for the <c>game.ended</c> publish specifically. Tests that assert on the
    /// published payload must wait for the publish itself: <c>MatchCompleted</c> is raised
    /// earlier in <c>CompleteAsync</c>, so waiting on the subscriber count returns while the
    /// publish is still pending and the assertion reads an empty recorder.
    /// </summary>
    private static Task WaitForGameEndedAsync(RecordingPublisher publisher) =>
        WaitUntilAsync(() => publisher.Published("game.ended"), "No game.ended message was published.");

    private sealed class CapturingDefinition : IContinuousGameDefinition
    {
        public string GameType => "arena-knockoff";
        public int RulesetVersion => 1;
        public object PredictionConstants => ArenaRulesetV1.PredictionConstants;
        public ArenaSimulation? Simulation { get; private set; }
        public IContinuousSimulation Create(DuelReservation reservation) => Simulation = new ArenaSimulation(reservation);
    }

    private sealed class RecordingSink(bool throwOnEnqueue = false) : ICompletedMatchSink
    {
        public CompletedMatch? Match { get; private set; }
        public int Count { get; private set; }
        public void Enqueue(CompletedMatch match)
        {
            Match = match; Count++;
            if (throwOnEnqueue) throw new InvalidOperationException("sink failure");
        }
    }

    private sealed class RecordingPublisher : IGameEventPublisher
    {
        // The coordinator publishes from its scheduler thread while tests read from the
        // test thread, so every access is guarded and readers get a snapshot. Handing out
        // the live List<T> would race even once the ordering above is correct.
        private readonly object _gate = new();
        private readonly List<string> _types = [];
        private readonly List<string> _payloads = [];
        private int _snapshotEventCount;

        public IReadOnlyList<string> Types { get { lock (_gate) return _types.ToArray(); } }
        public int SnapshotEventCount { get { lock (_gate) return _snapshotEventCount; } }

        public bool Published(string type) { lock (_gate) return _types.Contains(type); }

        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
        {
            var json = JsonSerializer.Serialize(message);
            using var document = JsonDocument.Parse(json);
            var type = document.RootElement.GetProperty("type").GetString()!;
            lock (_gate)
            {
                _types.Add(type);
                _payloads.Add(json);
                if (type == "snapshot") _snapshotEventCount++;
            }
            return Task.CompletedTask;
        }
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;

        public JsonElement GameEnded()
        {
            string? payload;
            lock (_gate)
            {
                var index = _types.IndexOf("game.ended");
                payload = index >= 0 ? _payloads[index] : null;
            }
            Assert.IsNotNull(payload, "No game.ended message was published.");
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.Clone();
        }
    }

    private sealed class FaultHarness
    {
        private FaultHarness(ManualTimeProvider time, ContinuousGameCoordinator coordinator,
            RecordingSink sink, RecordingPublisher publisher, long matchId)
        {
            Time = time; Coordinator = coordinator; Sink = sink; Publisher = publisher; MatchId = matchId;
        }
        public ManualTimeProvider Time { get; }
        public ContinuousGameCoordinator Coordinator { get; }
        public RecordingSink Sink { get; }
        public RecordingPublisher Publisher { get; }
        public long MatchId { get; }
        public int MatchCompletedCount { get; private set; }

        public static async Task<FaultHarness> StartAsync(FaultSimulation simulation)
        {
            var time = new ManualTimeProvider();
            var sink = new RecordingSink();
            var publisher = new RecordingPublisher();
            var coordinator = new ContinuousGameCoordinator(
                [new FaultDefinition(simulation)], time, sink, publisher,
                NullLogger<ContinuousGameCoordinator>.Instance);
            var started = await coordinator.StartAsync(new DuelReservation(
                9, 7, new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
                new DuelConfiguration("fault-test", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UnixEpoch, 1, null));
            Assert.IsTrue(started.Success, started.Error);
            var harness = new FaultHarness(time, coordinator, sink, publisher, started.MatchId);
            coordinator.MatchCompleted += _ => { harness.MatchCompletedCount++; return Task.CompletedTask; };
            return harness;
        }

        public async Task AttachBothAsync()
        {
            foreach (var participant in new[] { (501L, 10L, "one"), (502L, 20L, "two") })
                await AttachAsync(participant.Item1, participant.Item2, participant.Item3);
            await Task.Delay(25);
        }

        public async Task<AttachResult> AttachAsync(
            long userId, long sessionId, string connectionId, bool acknowledge = true)
        {
            var attached = await Coordinator.AttachParticipantAsync(
                MatchId, userId, sessionId, connectionId, new RealtimeSnapshotMailbox());
            Assert.IsTrue(attached.Ok, attached.Error);
            if (acknowledge)
                Coordinator.AcknowledgeAttach(connectionId, attached.Welcome!.SnapshotSequence);
            return attached;
        }
    }

    private sealed class ControlledHarness
    {
        private ControlledHarness(ContinuousGameCoordinator coordinator, long matchId)
        {
            Coordinator = coordinator; MatchId = matchId;
        }
        public ContinuousGameCoordinator Coordinator { get; }
        public long MatchId { get; }
        public int MatchCompletedCount { get; private set; }

        public static async Task<ControlledHarness> StartAsync(
            IContinuousSimulation simulation, ICompletedMatchSink sink)
        {
            var coordinator = new ContinuousGameCoordinator(
                [new ControlledDefinition(simulation)], TimeProvider.System, sink,
                new RecordingPublisher(), NullLogger<ContinuousGameCoordinator>.Instance);
            var started = await coordinator.StartAsync(new DuelReservation(
                9, 7, new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
                new DuelConfiguration("controlled-test", "bo3", 1,
                    new Dictionary<string, object?>(), "continuous"), DateTimeOffset.UnixEpoch, 1, null));
            Assert.IsTrue(started.Success, started.Error);
            var harness = new ControlledHarness(coordinator, started.MatchId);
            coordinator.MatchCompleted += _ => { harness.MatchCompletedCount++; return Task.CompletedTask; };
            return harness;
        }

        public async Task AttachBothAsync()
        {
            foreach (var participant in new[] { (501L, 10L, "one"), (502L, 20L, "two") })
            {
                var attached = await Coordinator.AttachParticipantAsync(MatchId,
                    participant.Item1, participant.Item2, participant.Item3, new RealtimeSnapshotMailbox());
                Assert.IsTrue(attached.Ok, attached.Error);
                Coordinator.AcknowledgeAttach(participant.Item3, attached.Welcome!.SnapshotSequence);
            }
        }
    }

    private sealed class ControlledDefinition(IContinuousSimulation simulation) : IContinuousGameDefinition
    {
        public string GameType => "controlled-test";
        public int RulesetVersion => 1;
        public object PredictionConstants => new { };
        public IContinuousSimulation Create(DuelReservation reservation) => simulation;
    }

    private sealed class BlockingSink : ICompletedMatchSink
    {
        public ManualResetEventSlim Entered { get; } = new(false);
        public ManualResetEventSlim Release { get; } = new(false);
        public int Count;
        public void Enqueue(CompletedMatch match)
        {
            Interlocked.Increment(ref Count);
            Entered.Set();
            Release.Wait(TimeSpan.FromSeconds(5));
        }
    }

    private sealed class BlockingProjectionSimulation : IContinuousSimulation
    {
        public ManualResetEventSlim ProjectionEntered { get; } = new(false);
        public ManualResetEventSlim ReleaseProjection { get; } = new(false);
        public long Tick => 0;
        public ContinuousMatchPhase Phase => ContinuousMatchPhase.AwaitingParticipants;
        public void SetInput(long sessionId, ContinuousInput input) { }
        public void SetNeutralInput(long sessionId) { }
        public ContinuousStepResult Step() => new(false, null);
        public object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs)
        {
            ProjectionEntered.Set();
            ReleaseProjection.Wait(TimeSpan.FromSeconds(5));
            return new { phase = "awaitingParticipants", players = Array.Empty<object>(), projectiles = Array.Empty<object>() };
        }
        public object SpectatorSnapshot() => new { };
        public ulong DeterministicHash() => 0;
    }

    private sealed class FaultDefinition(FaultSimulation simulation) : IContinuousGameDefinition
    {
        public string GameType => "fault-test";
        public int RulesetVersion => 1;
        public object PredictionConstants => new { };
        public IContinuousSimulation Create(DuelReservation reservation) => simulation;
    }

    private sealed class FaultSimulation(
        bool throwOnStep = false,
        int throwAfterSnapshotCount = int.MaxValue,
        bool completeOnStep = false,
        bool drawOnStep = false,
        bool unknownWinnerOnStep = false,
        long winnerUserId = 501) : IContinuousSimulation
    {
        private int _snapshotCount;
        public long Tick { get; private set; }
        public ContinuousMatchPhase Phase { get; private set; } = ContinuousMatchPhase.AwaitingParticipants;
        public void SetInput(long sessionId, ContinuousInput input) { }
        public void SetNeutralInput(long sessionId) { }
        public ContinuousStepResult Step()
        {
            if (throwOnStep) throw new InvalidOperationException("step failure");
            Tick++;
            if (!completeOnStep && !drawOnStep && !unknownWinnerOnStep)
                return new ContinuousStepResult(false, null);
            Phase = ContinuousMatchPhase.Ended;
            // Participant ids here are stable user ids, matching ArenaSimulation.Complete.
            CompletedParticipant[] participants = drawOnStep
                ? [new CompletedParticipant(501, 1, 1, "draw"), new CompletedParticipant(502, 1, 1, "draw")]
                : unknownWinnerOnStep
                    ? [new CompletedParticipant(999, 1, 2, "win"), new CompletedParticipant(502, 2, 0, "loss")]
                    : [new CompletedParticipant(winnerUserId, 1, 2, "win"),
                        new CompletedParticipant(winnerUserId == 501 ? 502 : 501, 2, 0, "loss")];
            return new ContinuousStepResult(true, new ContinuousCompletion(
                drawOnStep ? "draw" : "decided", null, participants,
                new { schemaVersion = 1 }, new Dictionary<long, object>()));
        }
        public object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs)
        {
            if (++_snapshotCount > throwAfterSnapshotCount) throw new InvalidOperationException("snapshot failure");
            return new { phase = Phase.ToString(), players = Array.Empty<object>(), projectiles = Array.Empty<object>() };
        }
        public object SpectatorSnapshot() => new { };
        public ulong DeterministicHash() => 0;
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private readonly List<ManualTimer> _timers = [];
        private long _timestamp;
        public override long TimestampFrequency => 1_000;
        public override long GetTimestamp() => _timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(_timestamp);
        public bool AllTimersDisposed => _timers.All(x => x.Disposed);
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
            public bool Disposed => _disposed;
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
