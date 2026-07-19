using System.Linq;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class FakePresence : IGamePresence
{
    public Dictionary<long, (int ch, bool brmble)> Users = new();
    public bool TryGetChannel(long userId, out int channelId, out bool isBrmble)
    {
        if (Users.TryGetValue(userId, out var v)) { channelId = v.ch; isBrmble = v.brmble; return true; }
        channelId = 0; isBrmble = false; return false;
    }
}
file sealed class FakePublisher : IGameEventPublisher
{
    public List<(string kind, object msg)> Sent = new();
    public Task PublishToUsersAsync(IReadOnlySet<long> u, object m) { Sent.Add(("users", m)); return Task.CompletedTask; }
    public Task PublishToChannelAsync(int c, object m) { Sent.Add(("channel", m)); return Task.CompletedTask; }
}
file sealed class FakeAnnouncer : IGameAnnouncer
{
    public List<string> Announcements = new();
    public Task AnnounceResultAsync(int c, string t) { Announcements.Add(t); return Task.CompletedTask; }
}

[TestClass]
public class GameSessionManagerTests
{
    private static GameSessionManager NewManager(IGamePresence presence, IGameEventPublisher pub, IGameAnnouncer ann, GameRepository repo)
    {
        var engines = new IGameEngine[] { new DeathrollEngine() };
        return new GameSessionManager(engines, new CryptoRandomSource(), presence, pub, ann, repo);
    }

    [TestMethod]
    public async Task Invite_RejectsWhenTargetNotInSameChannel()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (2, true);
        var repo = GameTestHelpers.NewRepo();
        var mgr = NewManager(presence, new FakePublisher(), new FakeAnnouncer(), repo);
        var result = await mgr.InviteAsync(inviterUserId: 10, targetUserId: 20, gameType: "deathroll");
        Assert.IsFalse(result.Success);
        Assert.IsTrue(result.Error!.Contains("channel", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public async Task Invite_RejectsNonBrmbleTarget()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (1, false);
        var mgr = NewManager(presence, new FakePublisher(), new FakeAnnouncer(), GameTestHelpers.NewRepo());
        var result = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.IsFalse(result.Success);
    }

    [TestMethod]
    public async Task AcceptedMatch_PlaysToCompletion_PersistsAndAnnounces()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (1, true);
        var repo = GameTestHelpers.NewRepo();
        var pub = new FakePublisher();
        var ann = new FakeAnnouncer();
        var mgr = NewManager(presence, pub, ann, repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.IsTrue(invite.Success);
        await mgr.RespondAsync(invite.MatchId, targetUserId: 20, accept: true);

        for (var i = 0; i < 100000 && mgr.IsMatchLive(invite.MatchId); i++)
        {
            var current = mgr.GetCurrentPlayer(invite.MatchId);
            await mgr.ActionAsync(invite.MatchId, current, new Dictionary<string, object?> { ["roll"] = true });
        }

        Assert.IsFalse(mgr.IsMatchLive(invite.MatchId));
        Assert.AreEqual(1, ann.Announcements.Count);

        var s10 = await repo.GetUserStatsAsync(10, "deathroll");
        var s20 = await repo.GetUserStatsAsync(20, "deathroll");
        Assert.AreEqual(1, s10.GamesPlayed);
        Assert.AreEqual(1, s20.GamesPlayed);
        Assert.AreEqual(1, s10.Wins + s20.Wins);
    }
}
