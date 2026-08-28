using System.Security.Cryptography;
using System.Text;
using Brmble.Server.Games.Continuous;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public sealed class RealtimeTicketStoreTests
{
    [TestMethod]
    public async Task ConcurrentConsumption_AllowsExactlyOneUse()
    {
        using var harness = TicketHarness.Create();
        var issued = harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);

        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(index =>
            Task.Run(() => harness.Store.TryConsume(issued.Token, out _))));

        Assert.AreEqual(1, results.Count(x => x));
        Assert.AreEqual(0, harness.Store.Count);
    }

    [TestMethod]
    public void Issue_EnforcesPerUserAndGlobalBoundsAndScavengesExpiredTickets()
    {
        using var harness = TicketHarness.Create(globalLimit: 3, perUserLimit: 2);
        harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);
        harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);
        Assert.ThrowsException<RealtimeTicketLimitException>(() =>
            harness.Store.Issue(100, 10, 91, RealtimeRole.Participant));
        harness.Store.Issue(200, 20, 91, RealtimeRole.Participant);
        Assert.ThrowsException<RealtimeTicketLimitException>(() =>
            harness.Store.Issue(300, 30, 91, RealtimeRole.Participant));

        harness.Advance(TimeSpan.FromSeconds(15));
        harness.Store.Scavenge();

        Assert.AreEqual(0, harness.Store.Count);
    }

    [TestMethod]
    public void TicketExpiresExactlyFifteenSecondsAfterIssue()
    {
        using var harness = TicketHarness.Create();
        var issued = harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);
        Assert.AreEqual(DateTimeOffset.UnixEpoch.AddSeconds(15), issued.ExpiresAt);
        harness.Advance(TimeSpan.FromMilliseconds(14_999));
        Assert.IsTrue(harness.Store.TryConsume(issued.Token, out var scope));
        Assert.AreEqual(new TicketScope(100, 10, 91, RealtimeRole.Participant), scope);

        var second = harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);
        harness.Advance(TimeSpan.FromSeconds(15));
        Assert.IsFalse(harness.Store.TryConsume(second.Token, out _));
    }

    [TestMethod]
    public void TheRawTokenIsNeverStored()
    {
        using var harness = TicketHarness.Create();
        var issued = harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);

        Assert.IsFalse(harness.Store.DebugKeys.Contains(issued.Token));
        Assert.IsTrue(harness.Store.DebugKeys.Contains(
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(issued.Token)))));
        Assert.AreEqual(43, issued.Token.Length);
        Assert.IsFalse(issued.Token.Contains('='));
    }

    [DataTestMethod]
    [DataRow(null)]
    [DataRow("https://games.example/realtime")]
    [DataRow("ws://games.example/realtime")]
    public void ProductionRejectsMissingOrNonWssRealtimeUrl(string? url)
    {
        var environment = new Mock<IHostEnvironment>();
        environment.SetupGet(x => x.EnvironmentName).Returns(Environments.Production);
        var validator = new GamesRealtimeOptionsValidator(environment.Object);

        var result = validator.Validate(null, new GamesRealtimeOptions
        {
            RealtimePublicWebSocketUrl = url,
        });

        Assert.IsTrue(result.Failed);
    }

    private sealed class TicketHarness : IDisposable
    {
        private TicketHarness(ManualTimeProvider time, RealtimeTicketStore store)
        {
            Time = time;
            Store = store;
        }

        public ManualTimeProvider Time { get; }
        public RealtimeTicketStore Store { get; }

        public static TicketHarness Create(int globalLimit = 10_000, int perUserLimit = 2)
        {
            var time = new ManualTimeProvider();
            var store = new RealtimeTicketStore(time, Options.Create(new GamesRealtimeOptions
            {
                RealtimePublicWebSocketUrl = "wss://games.example/realtime",
                GlobalTicketLimit = globalLimit,
                PerUserTicketLimit = perUserLimit,
            }));
            return new TicketHarness(time, store);
        }

        public void Advance(TimeSpan by) => Time.Advance(by);
        public void Dispose() => Store.Dispose();
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
