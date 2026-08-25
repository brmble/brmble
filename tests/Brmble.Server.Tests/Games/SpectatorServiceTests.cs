using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

internal sealed class SpectatorPublisher : IGameEventPublisher
{
    public List<(IReadOnlySet<long> Users, object Message)> ToUsers { get; } = [];
    public List<(int ChannelId, object Message)> ToChannel { get; } = [];

    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        ToUsers.Add((userIds, message));
        return Task.CompletedTask;
    }

    public Task PublishToChannelAsync(int channelId, object message)
    {
        ToChannel.Add((channelId, message));
        return Task.CompletedTask;
    }

    public IEnumerable<(IReadOnlySet<long> Users, T Message)> OfType<T>() =>
        ToUsers.Where(x => x.Message is T).Select(x => (x.Users, (T)x.Message));
}

internal sealed class SpectatorPresence : IGamePresence
{
    public Dictionary<long, int> Channels { get; } = [];
    public Dictionary<long, long> Users { get; } = [];

    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        isBrmble = true;
        userId = Users.TryGetValue(sessionId, out var u) ? u : 0;
        return Channels.TryGetValue(sessionId, out channelId);
    }

    public string? GetDisplayName(long sessionId) => null;

    public Task<bool> AreChallengesBlockedAsync(long sessionId) => Task.FromResult(false);
}

[TestClass]
public class SpectatorServiceTests
{
    private SpectatorPublisher _publisher = null!;
    private SpectatorPresence _presence = null!;
    private SpectatorService _service = null!;

    [TestInitialize]
    public void Setup()
    {
        _publisher = new SpectatorPublisher();
        _presence = new SpectatorPresence();
        // Watchers.
        Place(session: 30, user: 300, channel: 7);
        Place(session: 40, user: 400, channel: 7);
        // Players.
        Place(session: 10, user: 100, channel: 7);
        Place(session: 20, user: 200, channel: 7);
        // Someone in another channel.
        Place(session: 50, user: 500, channel: 8);
        _service = new SpectatorService(_publisher, _presence, NullLogger<SpectatorService>.Instance);
    }

    private void Place(long session, long user, int channel)
    {
        _presence.Channels[session] = channel;
        _presence.Users[session] = user;
    }

    private static SpectatorSourceFrame Frame(long matchId, long sequence, int channelId = 7) => new(
        MatchId: matchId,
        ChannelId: channelId,
        Configuration: new DuelConfiguration("deathroll", "1v1", 1, new Dictionary<string, object?>(), "discrete"),
        Players: [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
        ParticipantUserIds: new HashSet<long> { 100, 200 },
        Sequence: sequence,
        GeneratedAt: DateTimeOffset.UnixEpoch.AddSeconds(sequence),
        View: new DeathrollSpectatorView("deathroll", [10, 20], 10, 100, 50, false, null));

    private IReadOnlyList<(IReadOnlySet<long> Users, SpectatorSnapshotEvent Message)> Snapshots() =>
        _publisher.OfType<SpectatorSnapshotEvent>().ToList();

    [TestMethod]
    public async Task Subscribe_ToIdleChannel_SucceedsWithNullMatch()
    {
        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNull(result.Match);
        Assert.AreEqual(SpectatorSubscribeReason.None, result.Reason);
    }

    [TestMethod]
    public async Task Subscribe_ToLiveChannel_ReturnsTheCurrentFrame()
    {
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNotNull(result.Match);
        Assert.AreEqual(91, result.Match!.MatchId);
        Assert.AreEqual(1, result.Match.Sequence);
    }

    [TestMethod]
    public async Task Subscribe_ToAnotherChannel_RejectsWithNotSameChannel()
    {
        var result = await _service.SubscribeAsync(30, 300, 8);
        Assert.IsFalse(result.Success);
        Assert.AreEqual(SpectatorSubscribeReason.NotSameChannel, result.Reason);
    }

    [TestMethod]
    public async Task Subscribe_WithNoLiveSession_RejectsWithNotPresent()
    {
        var result = await _service.SubscribeAsync(999, 999, 7);
        Assert.IsFalse(result.Success);
        Assert.AreEqual(SpectatorSubscribeReason.NotPresent, result.Reason);
    }

    [TestMethod]
    public async Task Participant_NeverReceivesAFrameForTheirOwnMatch()
    {
        // A watcher who then accepts a challenge: still subscribed, now a participant.
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(10, 100, 7);

        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        var (users, _) = Snapshots().Single();
        CollectionAssert.AreEquivalent(new[] { 300L }, users.ToArray());
        Assert.IsFalse(users.Contains(100L), "A participant of match 91 must never receive a frame for match 91.");
    }

    [TestMethod]
    public async Task Frames_AtOrBelowTheHighWaterMark_AreDropped()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 2));
        await _service.PublishDiscreteFrameAsync(Frame(91, 2));
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.PublishDiscreteFrameAsync(Frame(91, 3));

        CollectionAssert.AreEqual(new long[] { 2, 3 }, Snapshots().Select(s => s.Message.Sequence).ToArray());
    }

    [TestMethod]
    public async Task ANewMatch_ResetsTheSequenceHighWaterMark()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 9));
        await _service.EndMatchAsync(91, 7, 9, MatchEndReason.Completed, new { winnerId = 100L });
        await _service.PublishDiscreteFrameAsync(Frame(92, 1));

        CollectionAssert.AreEqual(new long[] { 9, 1 }, Snapshots().Select(s => s.Message.Sequence).ToArray());
    }

    [TestMethod]
    public async Task MatchEnding_DoesNotRemoveTheSubscription()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        var ended = _publisher.OfType<SpectatorMatchEndedEvent>().Single();
        CollectionAssert.AreEquivalent(new[] { 300L }, ended.Users.ToArray());
        Assert.AreEqual("completed", ended.Message.Reason);
        Assert.AreEqual(0, _publisher.OfType<SpectatorClosedEvent>().Count(), "Ending a match must not close a subscription.");

        // The next match flows with no resubscribe.
        await _service.PublishDiscreteFrameAsync(Frame(92, 1));
        Assert.AreEqual(2, Snapshots().Count);
    }

    [TestMethod]
    public async Task EndMatch_IsIdempotentPerMatch()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count());
    }

    [TestMethod]
    public async Task Subscribe_AfterAMatchEnded_ReturnsNullMatch()
    {
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNull(result.Match, "An ended match is not live; a fresh subscriber sees idle.");
    }

    [TestMethod]
    public async Task Unsubscribe_StopsDeliveryAndPublishesUnsubscribed()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.UnsubscribeAsync(30, 300);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(0, Snapshots().Count);
        var closed = _publisher.OfType<SpectatorClosedEvent>().Single();
        Assert.AreEqual("unsubscribed", closed.Message.Reason);
        Assert.AreEqual(7, closed.Message.ChannelId);
    }

    [TestMethod]
    public async Task EndMatch_WithNoPriorFrame_AdoptsTheMatchAndPublishes()
    {
        // The forfeit shape: a match can end without ever having produced a frame.
        await _service.SubscribeAsync(30, 300, 7);
        await _service.EndMatchAsync(91, 7, 4, MatchEndReason.Forfeited, new { winnerId = 100L });

        var ended = _publisher.OfType<SpectatorMatchEndedEvent>().Single();
        CollectionAssert.AreEquivalent(new[] { 300L }, ended.Users.ToArray());
        Assert.AreEqual(91, ended.Message.MatchId);
        Assert.AreEqual(7, ended.Message.ChannelId);
        Assert.AreEqual(4, ended.Message.FinalSequence, "finalSequence must be carried onto the wire.");
        Assert.AreEqual("forfeited", ended.Message.Reason);

        // The match was adopted and marked ended, so a repeat end is suppressed.
        await _service.EndMatchAsync(91, 7, 4, MatchEndReason.Forfeited, new { winnerId = 100L });
        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count());
    }

    [TestMethod]
    public async Task EndMatch_ForADifferentLiveMatch_IsIgnored()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        await _service.EndMatchAsync(90, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        Assert.AreEqual(0, _publisher.OfType<SpectatorMatchEndedEvent>().Count(),
            "An end for a match other than the live one must not be published.");

        // Match 91 is untouched: still live, high-water mark still 1, so 2 flows and 1 drops.
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.PublishDiscreteFrameAsync(Frame(91, 2));
        CollectionAssert.AreEqual(new long[] { 1, 2 }, Snapshots().Select(s => s.Message.Sequence).ToArray());

        // And 91 can still be ended normally.
        await _service.EndMatchAsync(91, 7, 2, MatchEndReason.Completed, new { winnerId = 100L });
        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count());
    }

    [TestMethod]
    public async Task EndMatch_ForAnOlderMatchAfterTheCurrentOneEnded_ClobbersStateWithoutPublishing()
    {
        // CHARACTERISATION ONLY. This documents current behaviour; it does not claim the
        // behaviour is desirable. The adoption guard's `Ended is false` conjunct lets a
        // late end for an older match overwrite MatchId/LastSequence, then the `Ended`
        // check suppresses the publish. It is self-healing (the next frame for a genuinely
        // new match resets anyway) and Task 5 structurally cannot reorder two matches'
        // ends, so the logic is deliberately left as-is.
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });
        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count());

        // A late end for the older match 90 arrives after 91 already ended.
        await _service.EndMatchAsync(90, 7, 7, MatchEndReason.Completed, new { winnerId = 200L });
        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count(),
            "The stale end is silently absorbed: state is clobbered but nothing is published.");

        // Self-healing: the next real match resets the mark and flows normally.
        await _service.PublishDiscreteFrameAsync(Frame(92, 1));
        CollectionAssert.AreEqual(new long[] { 1, 1 }, Snapshots().Select(s => s.Message.Sequence).ToArray());
    }

    [TestMethod]
    public async Task Subscribing_Twice_DoesNotDuplicateDelivery()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(1, Snapshots().Count);
    }
}
