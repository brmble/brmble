using System.Security.Cryptography;
using System.Text;
using Brmble.Server.Games.Continuous;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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

    [TestMethod]
    public void ProductionDefaultsOmitRealtimeUrlAndExplicitWssConfigPasses()
    {
        var appSettings = FindRepositoryFile("src", "Brmble.Server", "appsettings.json");
        var defaults = new ConfigurationBuilder().AddJsonFile(appSettings).Build();
        Assert.IsNull(defaults["Games:RealtimePublicWebSocketUrl"]);
        var environment = new Mock<IHostEnvironment>();
        environment.SetupGet(x => x.EnvironmentName).Returns(Environments.Production);
        var validator = new GamesRealtimeOptionsValidator(environment.Object);

        Assert.IsTrue(validator.Validate(null, new GamesRealtimeOptions()).Failed);
        Assert.IsTrue(validator.Validate(null, new GamesRealtimeOptions
        {
            RealtimePublicWebSocketUrl = "wss://realtime.test.example/games",
        }).Succeeded);
    }

    [TestMethod]
    public void DockerLocalSuppliesRealtimeConfigurationForItsPublishedHttpsPort()
    {
        var composePath = FindRepositoryFile("docker-local", "docker-compose.yml");
        var compose = File.ReadAllText(composePath);

        StringAssert.Contains(compose,
            "Games__RealtimePublicWebSocketUrl: 'wss://localhost:1912/games/realtime'");
        StringAssert.Contains(compose,
            "Games__RealtimeAllowedOrigins__0: 'https://brmble.local'");
        StringAssert.Contains(compose,
            "Games__RealtimeAllowedOrigins__1: 'http://localhost:5173'");
    }

    [TestMethod]
    public async Task ProductionOptionsValidationFailsStartupWithoutUrlAndPassesWithExplicitWssUrl()
    {
        await Assert.ThrowsExceptionAsync<OptionsValidationException>(() =>
            StartOptionsHostAsync(null));

        using var host = await StartOptionsHostAsync("wss://realtime.test.example/games");
    }

    private static async Task<IHost> StartOptionsHostAsync(string? url)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Environment.EnvironmentName = Environments.Production;
        builder.Services.AddSingleton<IValidateOptions<GamesRealtimeOptions>, GamesRealtimeOptionsValidator>();
        builder.Services.AddOptions<GamesRealtimeOptions>()
            .Configure(options => options.RealtimePublicWebSocketUrl = url)
            .ValidateOnStart();
        var host = builder.Build();
        try
        {
            await host.StartAsync();
            return host;
        }
        catch
        {
            host.Dispose();
            throw;
        }
    }

    [TestMethod]
    public async Task PeriodicScavenger_RemovesExpiredTicketsAtFiveSecondTick()
    {
        using var harness = TicketHarness.Create();
        harness.Store.Issue(100, 10, 91, RealtimeRole.Participant);

        harness.Advance(TimeSpan.FromSeconds(15));
        await YieldUntilAsync(() => harness.Store.Count == 0);

        Assert.AreEqual(0, harness.Store.Count);
    }

    [TestMethod]
    public void Dispose_CancelsAndDisposesPeriodicScavengerSafely()
    {
        var harness = TicketHarness.Create();

        harness.Store.Dispose();
        harness.Store.Dispose();

        Assert.IsTrue(harness.Time.AllTimersDisposed);
        Assert.ThrowsException<ObjectDisposedException>(() =>
            harness.Store.Issue(100, 10, 91, RealtimeRole.Participant));
    }

    private static async Task YieldUntilAsync(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100 && !condition(); attempt++)
            await Task.Yield();
        Assert.IsTrue(condition(), "The timer continuation did not complete.");
    }

    private static string FindRepositoryFile(params string[] path)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine([directory.FullName, .. path]);
            if (File.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }
        throw new FileNotFoundException(string.Join(Path.DirectorySeparatorChar, path));
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
        private readonly List<ManualTimer> _timers = [];
        private DateTimeOffset _now = DateTimeOffset.UnixEpoch;
        public override DateTimeOffset GetUtcNow() => _now;
        public bool AllTimersDisposed => _timers.All(x => x.Disposed);
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
            public bool Disposed { get; private set; }
            public ManualTimer(ManualTimeProvider owner, TimerCallback callback, object? state,
                TimeSpan dueTime, TimeSpan period)
            {
                _owner = owner;
                _callback = callback;
                _state = state;
                Change(dueTime, period);
            }
            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                if (Disposed) return false;
                _dueAt = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : _owner._now + dueTime;
                _period = period;
                return true;
            }
            public void FireIfDue()
            {
                while (!Disposed && _owner._now >= _dueAt)
                {
                    _dueAt = _period == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : _dueAt + _period;
                    _callback(_state);
                }
            }
            public void Dispose() => Disposed = true;
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }
}
