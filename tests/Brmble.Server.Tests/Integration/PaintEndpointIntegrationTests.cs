using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Paint;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public sealed class PaintEndpointIntegrationTests
{
    private static readonly JsonSerializerOptions PaintJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private sealed record CreatePaintSessionResponse(Guid SessionId, int ChannelId);
    private sealed record PaintSourceDownloadResponse(string MimeType, string DataBase64);

    [TestMethod]
    public async Task PaintLifecycle_CreateJoinStrokeUndoClearEnd()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();

        var sessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);

        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/join", null)).EnsureSuccessStatusCode();

        var stroke = await app.Bob.PostAsJsonAsync($"/paint/sessions/{sessionId}/stroke", app.ValidStroke());
        Assert.AreEqual(HttpStatusCode.Created, stroke.StatusCode);

        var snapshot = await app.Bob.GetFromJsonAsync<PaintSessionSnapshot>(
            $"/paint/sessions/{sessionId}",
            PaintJsonOptions);
        Assert.IsNotNull(snapshot);
        Assert.AreEqual(PaintSessionStatus.Active, snapshot.Status);
        Assert.AreEqual(1, snapshot.Strokes.Count);

        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/undo", null)).EnsureSuccessStatusCode();
        (await app.Host.PostAsync($"/paint/sessions/{sessionId}/clear", null)).EnsureSuccessStatusCode();

        var end = await app.Host.PostAsync($"/paint/sessions/{sessionId}/end", null);
        Assert.AreEqual(HttpStatusCode.Accepted, end.StatusCode);
    }

    [TestMethod]
    public async Task PaintAccess_RequiresExplicitJoinAgainAfterReconnect()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();
        var sessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);

        var invited = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{sessionId}/summary",
            PaintJsonOptions);
        Assert.IsNotNull(invited);
        Assert.IsTrue(invited.CanJoin);
        Assert.IsFalse(invited.IsParticipant);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await app.Bob.GetAsync($"/paint/sessions/{sessionId}")).StatusCode);

        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/join", null)).EnsureSuccessStatusCode();
        var joined = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{sessionId}/summary",
            PaintJsonOptions);
        Assert.IsNotNull(joined);
        Assert.IsTrue(joined.IsParticipant);

        await app.Manager.HandleSessionDisconnectedAsync(app.BobMumbleSessionId);
        app.SetParticipantChannel(app.BobUserId, 5, app.BobMumbleSessionId + 100, app.BobMatrixUserId);

        var reconnected = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{sessionId}/summary",
            PaintJsonOptions);
        Assert.IsNotNull(reconnected);
        Assert.IsTrue(reconnected.CanJoin);
        Assert.IsFalse(reconnected.IsParticipant);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await app.Bob.GetAsync($"/paint/sessions/{sessionId}")).StatusCode);

        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/join", null)).EnsureSuccessStatusCode();
        var rejoined = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{sessionId}/summary",
            PaintJsonOptions);
        Assert.IsNotNull(rejoined);
        Assert.IsTrue(rejoined.IsParticipant);
    }

    [TestMethod]
    public async Task LateChannelMember_JoinsAndReceivesCurrentCanvasAndSource()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();
        app.SetParticipantChannel(app.BobUserId, 12, app.BobMumbleSessionId, app.BobMatrixUserId);

        var sessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);
        (await app.Host.PostAsJsonAsync($"/paint/sessions/{sessionId}/stroke", app.ValidStroke())).EnsureSuccessStatusCode();

        app.SetParticipantChannel(app.BobUserId, 5, app.BobMumbleSessionId + 100, app.BobMatrixUserId);

        var summary = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{sessionId}/summary",
            PaintJsonOptions);
        Assert.IsNotNull(summary);
        Assert.IsTrue(summary.CanJoin);
        Assert.IsFalse(summary.IsParticipant);

        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/join", null)).EnsureSuccessStatusCode();

        var snapshot = await app.Bob.GetFromJsonAsync<PaintSessionSnapshot>(
            $"/paint/sessions/{sessionId}",
            PaintJsonOptions);
        Assert.IsNotNull(snapshot);
        Assert.IsNotNull(snapshot.Source);
        Assert.AreEqual(PaintSessionStatus.Active, snapshot.Status);
        Assert.AreEqual("image/png", snapshot.Source.MimeType);
        Assert.AreEqual(1, snapshot.Strokes.Count);

        var source = await app.Bob.GetFromJsonAsync<PaintSourceDownloadResponse>(
            $"/paint/sessions/{sessionId}/source",
            PaintJsonOptions);
        Assert.IsNotNull(source);
        CollectionAssert.AreEqual(
            PaintIntegrationFixture.SourcePngA,
            Convert.FromBase64String(source.DataBase64));
    }

    [TestMethod]
    public async Task UserOutsideSessionChannel_CannotRetrieveTemporarySourceBytes()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();

        var sessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);
        (await app.Bob.PostAsync($"/paint/sessions/{sessionId}/join", null)).EnsureSuccessStatusCode();

        app.SetParticipantChannel(app.CharlieUserId, 12, app.CharlieMumbleSessionId, app.CharlieMatrixUserId);
        var forbidden = await app.Charlie.GetAsync($"/paint/sessions/{sessionId}/source");
        var forbiddenBody = await forbidden.Content.ReadAsStringAsync();

        Assert.AreEqual(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.IsFalse(forbiddenBody.Contains("dataBase64", StringComparison.Ordinal));
        Assert.IsFalse(forbiddenBody.Contains(
            Convert.ToBase64String(PaintIntegrationFixture.SourcePngA),
            StringComparison.Ordinal));

        var allowed = await app.Bob.GetFromJsonAsync<PaintSourceDownloadResponse>(
            $"/paint/sessions/{sessionId}/source",
            PaintJsonOptions);
        Assert.IsNotNull(allowed);
        CollectionAssert.AreEqual(
            PaintIntegrationFixture.SourcePngA,
            Convert.FromBase64String(allowed.DataBase64));
    }

    [TestMethod]
    public async Task EndedSession_SourceIsInaccessibleAndCleanupDeletesOnlyItsDirectory()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();

        var firstSessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);
        var secondSessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngB);
        var firstDirectory = app.SessionDirectory(firstSessionId);
        var secondDirectory = app.SessionDirectory(secondSessionId);

        Assert.IsTrue(Directory.Exists(firstDirectory));
        Assert.IsTrue(Directory.Exists(secondDirectory));

        var end = await app.Host.PostAsync($"/paint/sessions/{firstSessionId}/end", null);
        Assert.AreEqual(HttpStatusCode.Accepted, end.StatusCode);

        await app.CleanupService.ProcessPendingAsync(CancellationToken.None);

        var endedSource = await app.Host.GetAsync($"/paint/sessions/{firstSessionId}/source");
        Assert.AreEqual(HttpStatusCode.Conflict, endedSource.StatusCode);
        Assert.IsFalse(Directory.Exists(firstDirectory));
        Assert.IsTrue(Directory.Exists(secondDirectory));

        var remaining = await app.Host.GetFromJsonAsync<PaintSourceDownloadResponse>(
            $"/paint/sessions/{secondSessionId}/source",
            PaintJsonOptions);
        Assert.IsNotNull(remaining);
        CollectionAssert.AreEqual(
            PaintIntegrationFixture.SourcePngB,
            Convert.FromBase64String(remaining.DataBase64));
    }

    [TestMethod]
    public async Task UngracefulRestartRecovery_DeletesFilesystemSessionWithNoLiveManagerEntry()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"paint-integration-{Guid.NewGuid():N}.db");
        var storageRoot = Path.Combine(Path.GetTempPath(), $"paint-sessions-{Guid.NewGuid():N}");

        await using var app = await PaintIntegrationFixture.StartAsync(databasePath, storageRoot);
        var sessionId = await app.CreateSessionAsync(app.Host, 5, PaintIntegrationFixture.SourcePngA);
        var sessionDirectory = app.SessionDirectory(sessionId);
        Assert.IsTrue(Directory.Exists(sessionDirectory));

        await app.CleanupRepository.RecordPendingAsync(sessionId, CancellationToken.None);

        await using var restart = new RestartCleanupHarness(databasePath, storageRoot);
        await restart.CleanupService.ProcessPendingAsync(CancellationToken.None);

        Assert.IsFalse(Directory.Exists(sessionDirectory));
        Assert.AreEqual(0, (await restart.CleanupRepository.GetDueAsync(CancellationToken.None)).Count);
    }

    private sealed class PaintIntegrationFixture : IAsyncDisposable
    {
        public static readonly byte[] SourcePngA = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        public static readonly byte[] SourcePngB = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==");

        private readonly WebApplication _app;
        private readonly TestPresence _presence;
        private readonly string _databasePath;

        public HttpClient Host { get; private set; } = null!;
        public HttpClient Bob { get; private set; } = null!;
        public HttpClient Charlie { get; private set; } = null!;
        public long HostUserId { get; private set; }
        public long BobUserId { get; private set; }
        public long CharlieUserId { get; private set; }
        public string BobMatrixUserId { get; private set; } = null!;
        public string CharlieMatrixUserId { get; private set; } = null!;
        public int BobMumbleSessionId { get; private set; }
        public int CharlieMumbleSessionId { get; private set; }
        public string StorageRoot { get; }
        public PaintSessionManager Manager => _app.Services.GetRequiredService<PaintSessionManager>();
        public PaintTemporaryCleanupRepository CleanupRepository => _app.Services.GetRequiredService<PaintTemporaryCleanupRepository>();
        public PaintTemporaryCleanupService CleanupService => _app.Services.GetRequiredService<PaintTemporaryCleanupService>();

        private PaintIntegrationFixture(
            WebApplication app,
            TestPresence presence,
            string databasePath,
            string storageRoot)
        {
            _app = app;
            _presence = presence;
            _databasePath = databasePath;
            StorageRoot = storageRoot;
        }

        public static async Task<PaintIntegrationFixture> StartAsync(
            string? databasePath = null,
            string? storageRoot = null)
        {
            var dbPath = databasePath ?? Path.Combine(Path.GetTempPath(), $"paint-integration-{Guid.NewGuid():N}.db");
            var rootPath = storageRoot ?? Path.Combine(Path.GetTempPath(), $"paint-sessions-{Guid.NewGuid():N}");
            var database = new Database($"Data Source={dbPath}");
            database.Initialize();

            var presence = new TestPresence();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton(database);
            builder.Services.AddSingleton<UserRepository>();
            builder.Services.AddSingleton<ICertificateHashExtractor, HeaderCertificateHashExtractor>();
            builder.Services.AddSingleton<IPaintPresence>(presence);
            builder.Services.AddSingleton<IPaintEventPublisher, TestPublisher>();
            builder.Services.AddSingleton<PaintRateLimiter>();
            builder.Services.AddSingleton<PaintSourceValidator>();
            builder.Services.AddSingleton<IOptions<PaintStorageOptions>>(
                Options.Create(new PaintStorageOptions { RootPath = rootPath }));
            builder.Services.AddSingleton<IPaintTemporarySourceStore, FilePaintTemporarySourceStore>();
            builder.Services.AddSingleton<PaintTemporaryCleanupRepository>();
            builder.Services.AddSingleton<PaintSessionManager>();
            builder.Services.AddSingleton<IPaintTemporaryDataLifetime>(services =>
                services.GetRequiredService<PaintSessionManager>());
            builder.Services.AddSingleton<PaintTemporaryCleanupService>();

            var app = builder.Build();
            app.MapPaintEndpoints();
            await app.StartAsync();

            var users = app.Services.GetRequiredService<UserRepository>();
            var host = await users.Insert($"host-cert-{Guid.NewGuid():N}", "host");
            var bob = await users.Insert($"bob-cert-{Guid.NewGuid():N}", "bob");
            var charlie = await users.Insert($"charlie-cert-{Guid.NewGuid():N}", "charlie");

            var fixture = new PaintIntegrationFixture(app, presence, dbPath, rootPath)
            {
                HostUserId = host.Id,
                BobUserId = bob.Id,
                CharlieUserId = charlie.Id,
                BobMatrixUserId = bob.MatrixUserId,
                CharlieMatrixUserId = charlie.MatrixUserId,
                BobMumbleSessionId = 101,
                CharlieMumbleSessionId = 102,
            };

            fixture.SetParticipantChannel(host.Id, 5, 100, host.MatrixUserId);
            fixture.SetParticipantChannel(bob.Id, 5, fixture.BobMumbleSessionId, bob.MatrixUserId);
            fixture.SetParticipantChannel(charlie.Id, 12, fixture.CharlieMumbleSessionId, charlie.MatrixUserId);

            fixture.Host = app.GetTestClient();
            fixture.Host.DefaultRequestHeaders.Add("X-Test-Certificate", host.CertHash);
            fixture.Bob = app.GetTestClient();
            fixture.Bob.DefaultRequestHeaders.Add("X-Test-Certificate", bob.CertHash);
            fixture.Charlie = app.GetTestClient();
            fixture.Charlie.DefaultRequestHeaders.Add("X-Test-Certificate", charlie.CertHash);
            return fixture;
        }

        public void SetParticipantChannel(long userId, int channelId, int mumbleSessionId, string matrixUserId)
        {
            _presence.Participants[userId] = new PaintPresenceParticipant(userId, channelId, mumbleSessionId, matrixUserId);
            if (userId == BobUserId)
            {
                BobMumbleSessionId = mumbleSessionId;
            }

            if (userId == CharlieUserId)
            {
                CharlieMumbleSessionId = mumbleSessionId;
            }
        }

        public async Task<Guid> CreateSessionAsync(HttpClient client, int channelId, byte[] sourceBytes)
        {
            var create = await client.PostAsJsonAsync("/paint/sessions", new
            {
                channelId,
                source = new
                {
                    mimeType = "image/png",
                    dataBase64 = Convert.ToBase64String(sourceBytes),
                },
            });
            create.EnsureSuccessStatusCode();
            var created = await create.Content.ReadFromJsonAsync<CreatePaintSessionResponse>();
            Assert.IsNotNull(created);
            Assert.AreEqual(channelId, created.ChannelId);
            return created.SessionId;
        }

        public object ValidStroke() => new
        {
            correlationId = Guid.NewGuid(),
            generation = 0,
            tool = "pen",
            color = "#EF4444",
            width = 6,
            points = new[] { new { x = 0.1, y = 0.2, pressure = 0.5 } },
        };

        public string SessionDirectory(Guid sessionId)
            => Path.Combine(StorageRoot, sessionId.ToString("N"));

        public async ValueTask DisposeAsync()
        {
            Host.Dispose();
            Bob.Dispose();
            Charlie.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();

            try
            {
                if (Directory.Exists(StorageRoot))
                {
                    Directory.Delete(StorageRoot, recursive: true);
                }
            }
            catch
            {
                // Best effort temp cleanup for tests only.
            }

            try
            {
                if (File.Exists(_databasePath))
                {
                    File.Delete(_databasePath);
                }
            }
            catch
            {
                // Best effort temp cleanup for tests only.
            }
        }

        private sealed class HeaderCertificateHashExtractor : ICertificateHashExtractor
        {
            public string? GetCertHash(HttpContext context)
                => context.Request.Headers["X-Test-Certificate"].FirstOrDefault();
        }

        private sealed class TestPresence : IPaintPresence
        {
            public Dictionary<long, PaintPresenceParticipant> Participants { get; } = [];

            public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant)
                => Participants.TryGetValue(userId, out participant!);

            public bool TryGetParticipantByMumbleSessionId(
                int mumbleSessionId,
                out PaintPresenceParticipant participant)
            {
                participant = Participants.Values.SingleOrDefault(
                    value => value.MumbleSessionId == mumbleSessionId)!;
                return participant is not null;
            }

            public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId)
                => Participants.Values.Where(value => value.ChannelId == channelId).ToArray();
        }

        private sealed class TestPublisher : IPaintEventPublisher
        {
            public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
                => Task.CompletedTask;

            public Task PublishPreviewToUsersAsync(
                IReadOnlySet<long> userIds,
                Guid sessionId,
                long authorUserId,
                object message)
                => Task.CompletedTask;

            public Task PublishToChannelAsync(int channelId, object message)
                => Task.CompletedTask;
        }
    }

    private sealed class RestartCleanupHarness : IAsyncDisposable
    {
        private readonly string _databasePath;
        private readonly string _storageRoot;

        public PaintTemporaryCleanupRepository CleanupRepository { get; }
        public PaintTemporaryCleanupService CleanupService { get; }

        public RestartCleanupHarness(string databasePath, string storageRoot)
        {
            _databasePath = databasePath;
            _storageRoot = storageRoot;

            var database = new Database($"Data Source={databasePath}");
            database.Initialize();
            var repository = new PaintTemporaryCleanupRepository(database);
            var store = new FilePaintTemporarySourceStore(
                Options.Create(new PaintStorageOptions { RootPath = storageRoot }));
            var manager = new PaintSessionManager(
                new EmptyPresence(),
                new EmptyPublisher(),
                new PaintSourceValidator(),
                store,
                repository,
                new PaintRateLimiter());

            CleanupRepository = repository;
            CleanupService = new PaintTemporaryCleanupService(repository, store, manager);
        }

        public ValueTask DisposeAsync()
        {
            try
            {
                if (Directory.Exists(_storageRoot))
                {
                    Directory.Delete(_storageRoot, recursive: true);
                }
            }
            catch
            {
                // Best effort temp cleanup for tests only.
            }

            try
            {
                if (File.Exists(_databasePath))
                {
                    File.Delete(_databasePath);
                }
            }
            catch
            {
                // Best effort temp cleanup for tests only.
            }

            return ValueTask.CompletedTask;
        }

        private sealed class EmptyPresence : IPaintPresence
        {
            public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant)
            {
                participant = default!;
                return false;
            }

            public bool TryGetParticipantByMumbleSessionId(
                int mumbleSessionId,
                out PaintPresenceParticipant participant)
            {
                participant = default!;
                return false;
            }

            public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId)
                => [];
        }

        private sealed class EmptyPublisher : IPaintEventPublisher
        {
            public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
                => Task.CompletedTask;

            public Task PublishPreviewToUsersAsync(
                IReadOnlySet<long> userIds,
                Guid sessionId,
                long authorUserId,
                object message)
                => Task.CompletedTask;

            public Task PublishToChannelAsync(int channelId, object message)
                => Task.CompletedTask;
        }
    }
}
