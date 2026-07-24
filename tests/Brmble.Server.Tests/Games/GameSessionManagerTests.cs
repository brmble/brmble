using System.Linq;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Dapper;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class FakePresence : IGamePresence
{
    public Dictionary<long, (int ch, bool brmble, long userId)> Users = new();
    public HashSet<long> Blocked = new();
    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        if (Users.TryGetValue(sessionId, out var v)) { channelId = v.ch; isBrmble = v.brmble; userId = v.userId; return true; }
        channelId = 0; isBrmble = false; userId = 0; return false;
    }
    public string? GetDisplayName(long sessionId) => $"user{sessionId}";
    public Task<bool> AreChallengesBlockedAsync(long sessionId) => Task.FromResult(Blocked.Contains(sessionId));
}
file sealed class FakePublisher : IGameEventPublisher
{
    public List<(string kind, object msg)> Sent = new();
    public Task PublishToUsersAsync(IReadOnlySet<long> u, object m) { Sent.Add(("users", m)); return Task.CompletedTask; }
    public Task PublishToChannelAsync(int c, object m) { Sent.Add(("channel", m)); return Task.CompletedTask; }
}

// Deterministic RNG so the manager tests never depend on chance. Each roll returns
// roughly half the current ceiling (never 1 until the ceiling itself is 1), so a
// Deathroll match always lasts several non-terminal rolls and then ends
// predictably — instead of a random first roll of 1 ending it instantly and
// skipping the roll-feed lines these tests assert on.
file sealed class HalvingRandom : IRandomSource
{
    public int Roll(int maxInclusive) => maxInclusive <= 1 ? 1 : Math.Max(1, maxInclusive / 2);
}

[TestClass]
public class GameSessionManagerTests
{
    private static GameSessionManager NewManager(IGamePresence presence, IGameEventPublisher pub, GameRepository repo)
    {
        var engines = new IGameEngine[] { new DeathrollEngine(), new RpsEngine() };
        return new GameSessionManager(engines, new HalvingRandom(), presence, pub, repo);
    }

    private static bool SentType(IEnumerable<(string kind, object msg)> sent, string type) =>
        sent.Any(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == type);

    private static List<string> FeedTexts(IEnumerable<(string kind, object msg)> sent) =>
        sent.Where(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.feed")
            .Select(s => s.msg.GetType().GetProperty("text")?.GetValue(s.msg) as string ?? "")
            .ToList();

    // The `draw` flag of a game.ended message, or null if none was sent.
    private static bool? EndedDraw(IEnumerable<(string kind, object msg)> sent)
    {
        var ended = sent.LastOrDefault(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.ended");
        if (ended.msg is null) return null;
        return ended.msg.GetType().GetProperty("draw")?.GetValue(ended.msg) as bool?;
    }

    // The `active` flag of every game.duelState published to a channel, in order.
    private static List<bool> DuelStates(IEnumerable<(string kind, object msg)> sent) =>
        sent.Where(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.duelState")
            .Select(s => (bool)(s.msg.GetType().GetProperty("active")?.GetValue(s.msg) ?? false))
            .ToList();

    // The `turnStarted` flag of the most recent game.stateUpdated, or null if none.
    private static bool? LastTurnStarted(IEnumerable<(string kind, object msg)> sent)
    {
        var upd = sent.LastOrDefault(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.stateUpdated");
        if (upd.msg is null) return null;
        return upd.msg.GetType().GetProperty("turnStarted")?.GetValue(upd.msg) as bool?;
    }

    [TestMethod]
    public async Task Invite_NotifiesInviter_WithPendingEvent()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        await mgr.InviteAsync(10, 20, "deathroll");

        Assert.IsTrue(SentType(pub.Sent, "game.invited"), "target should be invited");
        Assert.IsTrue(SentType(pub.Sent, "game.invitePending"), "inviter should get a pending event");
    }

    [TestMethod]
    public async Task ExplicitDecline_EmitsGameDeclined()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: false);

        Assert.IsTrue(SentType(pub.Sent, "game.declined"));
        Assert.IsFalse(SentType(pub.Sent, "game.expired"));
    }

    [TestMethod]
    public async Task InviteExpiry_EmitsGameExpired()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.ExpireInviteForTestAsync(invite.MatchId);

        Assert.IsTrue(SentType(pub.Sent, "game.expired"));
        Assert.IsFalse(SentType(pub.Sent, "game.declined"));
    }

    [TestMethod]
    public async Task Invite_MarksChannelBusy_WithActiveDuelState()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        await mgr.InviteAsync(10, 20, "deathroll");

        var states = DuelStates(pub.Sent);
        Assert.IsTrue(states.Count > 0, "invite should publish a duelState");
        Assert.IsTrue(states[0], "a pending invite should mark the channel busy (active: true)");
    }

    [TestMethod]
    public async Task Decline_ClearsChannelBusy_WithInactiveDuelState()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: false);

        var states = DuelStates(pub.Sent);
        Assert.IsTrue(states.Count >= 2, "invite then decline should publish two duelStates");
        Assert.IsTrue(states.First(), "invite marks the channel busy");
        Assert.IsFalse(states.Last(), "decline clears the channel-busy badge (active: false)");
    }

    [TestMethod]
    public async Task InviteExpiry_ClearsChannelBusy_WithInactiveDuelState()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.ExpireInviteForTestAsync(invite.MatchId);

        var states = DuelStates(pub.Sent);
        Assert.IsTrue(states.First(), "invite marks the channel busy");
        Assert.IsFalse(states.Last(), "expiry clears the channel-busy badge (active: false)");
    }

    [TestMethod]
    public async Task Invite_RejectsWhenTargetNotInSameChannel()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (2, true, 20);
        var repo = GameTestHelpers.NewRepo();
        var mgr = NewManager(presence, new FakePublisher(), repo);
        var result = await mgr.InviteAsync(inviterSession: 10, targetSession: 20, gameType: "deathroll");
        Assert.IsFalse(result.Success);
        Assert.IsTrue(result.Error!.Contains("channel", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public async Task Invite_RejectsNonBrmbleTarget()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, false, 20);
        var mgr = NewManager(presence, new FakePublisher(), GameTestHelpers.NewRepo());
        var result = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.IsFalse(result.Success);
    }

    [TestMethod]
    public async Task Invite_RejectsBlockedTarget_WithBlockedReason()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        presence.Blocked.Add(20);
        var mgr = NewManager(presence, new FakePublisher(), GameTestHelpers.NewRepo());

        var result = await mgr.InviteAsync(10, 20, "deathroll");

        Assert.IsFalse(result.Success);
        Assert.AreEqual(InviteRejectReason.Blocked, result.Reason);
    }

    [TestMethod]
    public async Task AcceptedMatch_PlaysToCompletion_PersistsAndFeeds()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var repo = GameTestHelpers.NewRepo();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.IsTrue(invite.Success);
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        for (var i = 0; i < 100000 && mgr.IsMatchLive(invite.MatchId); i++)
        {
            var current = mgr.GetCurrentPlayer(invite.MatchId);
            await mgr.ActionAsync(invite.MatchId, current, new Dictionary<string, object?> { ["roll"] = true });
        }

        Assert.IsFalse(mgr.IsMatchLive(invite.MatchId));

        // Ephemeral spectator feed is broadcast to the channel (never Matrix):
        // a start line, at least one roll line, and exactly one terminal line.
        var feed = FeedTexts(pub.Sent);
        Assert.IsTrue(feed.Any(t => t.Contains("started")), "expected a start feed line");
        Assert.IsTrue(feed.Any(t => t.StartsWith("🎲")), "expected roll feed lines");
        Assert.AreEqual(1, feed.Count(t => t.StartsWith("💀")), "expected one terminal feed line");

        var s10 = await repo.GetUserStatsAsync(10, "deathroll");
        var s20 = await repo.GetUserStatsAsync(20, "deathroll");
        Assert.AreEqual(1, s10.GamesPlayed);
        Assert.AreEqual(1, s20.GamesPlayed);
        Assert.AreEqual(1, s10.Wins + s20.Wins);
    }

    [TestMethod]
    public async Task CompletedMatch_PersistsVersionedMetadataEnvelope()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var mgr = NewManager(presence, new FakePublisher(), repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);
        for (var i = 0; i < 100000 && mgr.IsMatchLive(invite.MatchId); i++)
        {
            var current = mgr.GetCurrentPlayer(invite.MatchId);
            await mgr.ActionAsync(invite.MatchId, current, new Dictionary<string, object?> { ["roll"] = true });
        }

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches ORDER BY id DESC LIMIT 1");
        Assert.IsTrue(matchMeta.Contains("\"schemaVersion\":1"));
        Assert.IsTrue(matchMeta.Contains("\"summary\""));
        Assert.IsTrue(matchMeta.Contains("startingCeiling"));

        var partMetas = (await conn.QueryAsync<string>(
            "SELECT metadata_json FROM game_match_participants")).ToList();
        Assert.AreEqual(2, partMetas.Count);
        foreach (var m in partMetas)
        {
            Assert.IsTrue(m.Contains("\"schemaVersion\":1"));
            Assert.IsTrue(m.Contains("displayName"));
            Assert.IsTrue(m.Contains("deathroll"));
        }
    }

    [TestMethod]
    public async Task ForfeitedMatch_PersistsVersionedMetadataEnvelope()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var mgr = NewManager(presence, new FakePublisher(), repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);
        await mgr.ForfeitAsync(invite.MatchId, sessionId: mgr.GetCurrentPlayer(invite.MatchId), reason: "quit");

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches ORDER BY id DESC LIMIT 1");
        Assert.IsTrue(matchMeta.Contains("\"schemaVersion\":1"));
        Assert.IsTrue(matchMeta.Contains("\"summary\""));

        var partMetas = (await conn.QueryAsync<string>(
            "SELECT metadata_json FROM game_match_participants")).ToList();
        Assert.AreEqual(2, partMetas.Count);
        Assert.IsTrue(partMetas.All(m => m.Contains("displayName") && m.Contains("deathroll")));
    }

    [TestMethod]
    public async Task Forfeit_ByNonParticipant_IsIgnored()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        presence.Users[99] = (1, true, 99); // an unrelated authenticated user
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        // A third party must not be able to end someone else's live match.
        await mgr.ForfeitAsync(invite.MatchId, sessionId: 99, reason: "grief");

        Assert.IsTrue(mgr.IsMatchLive(invite.MatchId), "non-participant forfeit must not end the match");
        Assert.IsFalse(SentType(pub.Sent, "game.ended"));
        using var conn = db.CreateConnection();
        var matches = await conn.QuerySingleAsync<long>("SELECT COUNT(*) FROM game_matches");
        Assert.AreEqual(0, matches, "no match should be persisted from a bogus forfeit");
    }

    [TestMethod]
    public async Task Decline_ByNonParticipant_IsIgnored()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        // A user who isn't the inviter or target can't cancel the pending invite.
        await mgr.RespondAsync(invite.MatchId, targetSession: 99, accept: false);

        Assert.IsFalse(SentType(pub.Sent, "game.declined"));
        // The invite is still pending, so the real target can accept it.
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);
        Assert.IsTrue(mgr.IsMatchLive(invite.MatchId));
    }

    [TestMethod]
    public async Task Rps_SimultaneousMatch_PlaysToCompletion_PersistsAndFeeds()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var repo = GameTestHelpers.NewRepo();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        Assert.IsTrue(invite.Success);
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        // Both players commit each round; session 10 (rock) always beats 20 (scissors),
        // so 10 takes the best-of-3 in two decisive rounds.
        for (var round = 0; round < 2 && mgr.IsMatchLive(invite.MatchId); round++)
        {
            await mgr.ActionAsync(invite.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await mgr.ActionAsync(invite.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        Assert.IsFalse(mgr.IsMatchLive(invite.MatchId), "match should be decided after two rounds");

        var feed = FeedTexts(pub.Sent);
        Assert.IsTrue(feed.Any(t => t.Contains("started")), "expected a start feed line");
        Assert.IsTrue(feed.Any(t => t.StartsWith("✊")), "expected round feed lines");
        Assert.AreEqual(1, feed.Count(t => t.StartsWith("🏆")), "expected one terminal feed line");

        var s10 = await repo.GetUserStatsAsync(10, "rps");
        var s20 = await repo.GetUserStatsAsync(20, "rps");
        Assert.AreEqual(1, s10.GamesPlayed);
        Assert.AreEqual(1, s20.GamesPlayed);
        Assert.AreEqual(1, s10.Wins);
        Assert.AreEqual(0, s20.Wins);
    }

    [TestMethod]
    public async Task Invite_RejectsSecondDuelInSameChannel_WithChannelBusyReason()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        presence.Users[30] = (1, true, 30);
        presence.Users[40] = (1, true, 40);
        var mgr = NewManager(presence, new FakePublisher(), GameTestHelpers.NewRepo());

        // A pending invite already occupies the channel's single duel slot.
        var first = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.IsTrue(first.Success);

        var second = await mgr.InviteAsync(30, 40, "deathroll");
        Assert.IsFalse(second.Success);
        Assert.AreEqual(InviteRejectReason.ChannelBusy, second.Reason);
    }

    [TestMethod]
    public async Task Forfeit_PendingInvite_CancelsWithoutPersisting()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        // Simulate a disconnect/channel-change while the invite is still pending.
        await mgr.ForfeitAsync(invite.MatchId, sessionId: 10, reason: "disconnect");

        Assert.IsTrue(SentType(pub.Sent, "game.expired"), "pending invite should be cancelled as expired");
        Assert.IsFalse(SentType(pub.Sent, "game.ended"));
        // Both users are freed immediately, so a new invite can start right away.
        Assert.IsFalse(mgr.TryGetActiveMatch(10, out _));
        Assert.IsFalse(mgr.TryGetActiveMatch(20, out _));
        using var conn = db.CreateConnection();
        var matches = await conn.QuerySingleAsync<long>("SELECT COUNT(*) FROM game_matches");
        Assert.AreEqual(0, matches, "a cancelled pending invite must not be persisted");
    }

    [TestMethod]
    public async Task Rps_FirstPickDoesNotRestartSharedWindow()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        // First player commits — the shared 15s window must NOT restart, so the
        // opponent keeps their remaining time instead of getting a fresh 15s.
        await mgr.ActionAsync(invite.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        Assert.AreEqual(false, LastTurnStarted(pub.Sent),
            "first pick in a simultaneous round must not restart the commit window");

        // Second player commits — the round resolves and the next window opens.
        await mgr.ActionAsync(invite.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        Assert.AreEqual(true, LastTurnStarted(pub.Sent),
            "resolving the round starts a fresh commit window");
    }

    [TestMethod]
    public async Task Rps_BothIdleTwice_EndsAsDraw_PersistsAndFlags()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var repo = GameTestHelpers.NewRepo();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        // Both players go AFK for two consecutive rounds.
        await mgr.FireTurnTimeoutForTestAsync(invite.MatchId);
        await mgr.FireTurnTimeoutForTestAsync(invite.MatchId);

        Assert.IsTrue(SentType(pub.Sent, "game.ended"), "match should end");
        Assert.AreEqual(true, EndedDraw(pub.Sent), "game.ended should carry draw: true");

        var s10 = await repo.GetUserStatsAsync(10, "rps");
        var s20 = await repo.GetUserStatsAsync(20, "rps");
        Assert.AreEqual(1, s10.Draws, "player 10 records a draw");
        Assert.AreEqual(1, s20.Draws, "player 20 records a draw");
        Assert.AreEqual(0, s10.Wins);
        Assert.AreEqual(0, s20.Wins);
    }
}
