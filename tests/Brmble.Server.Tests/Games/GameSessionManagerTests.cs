using System.Linq;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
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

[TestClass]
public class GameSessionManagerTests
{
    private static GameSessionManager NewManager(IGamePresence presence, IGameEventPublisher pub, GameRepository repo)
    {
        var engines = new IGameEngine[] { new DeathrollEngine() };
        return new GameSessionManager(engines, new CryptoRandomSource(), presence, pub, repo);
    }

    private static bool SentType(IEnumerable<(string kind, object msg)> sent, string type) =>
        sent.Any(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == type);

    private static List<string> FeedTexts(IEnumerable<(string kind, object msg)> sent) =>
        sent.Where(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.feed")
            .Select(s => s.msg.GetType().GetProperty("text")?.GetValue(s.msg) as string ?? "")
            .ToList();

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
}
