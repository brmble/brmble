using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Paint;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public sealed class PaintEndpointIntegrationTests
{
    private static readonly JsonSerializerOptions PaintJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private sealed record CreatePaintSessionResponse(Guid SessionId);

    [TestMethod]
    public async Task PaintLifecycle_CreateAttachJoinStrokeUndoClearEnd()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();

        var create = await app.Host.PostAsJsonAsync("/paint/sessions", new
        {
            channelId = 5,
            participantSessionIds = new[] { app.BobMumbleSessionId },
        });
        create.EnsureSuccessStatusCode();
        var created = await create.Content.ReadFromJsonAsync<CreatePaintSessionResponse>();
        Assert.IsNotNull(created);

        (await app.Host.PostAsJsonAsync($"/paint/sessions/{created.SessionId}/source", new { sourceEventId = "$source" })).EnsureSuccessStatusCode();
        (await app.Bob.PostAsync($"/paint/sessions/{created.SessionId}/join", null)).EnsureSuccessStatusCode();

        var stroke = await app.Bob.PostAsJsonAsync($"/paint/sessions/{created.SessionId}/stroke", app.ValidStroke());
        Assert.AreEqual(HttpStatusCode.Created, stroke.StatusCode);

        (await app.Bob.PostAsync($"/paint/sessions/{created.SessionId}/undo", null)).EnsureSuccessStatusCode();
        (await app.Host.PostAsync($"/paint/sessions/{created.SessionId}/clear", null)).EnsureSuccessStatusCode();

        var end = await app.Host.PostAsync($"/paint/sessions/{created.SessionId}/end", null);
        Assert.AreEqual(HttpStatusCode.Accepted, end.StatusCode);
    }

    [TestMethod]
    public async Task PaintAccess_RequiresExplicitJoinAgainAfterReconnect()
    {
        await using var app = await PaintIntegrationFixture.StartAsync();
        var create = await app.Host.PostAsJsonAsync(
            "/paint/sessions",
            new
            {
                channelId = 5,
                participantSessionIds =
                    new[] { app.BobMumbleSessionId },
            });
        create.EnsureSuccessStatusCode();
        var created = await create.Content
            .ReadFromJsonAsync<CreatePaintSessionResponse>();
        Assert.IsNotNull(created);
        (await app.Host.PostAsJsonAsync(
            $"/paint/sessions/{created.SessionId}/source",
            new { sourceEventId = "$source" }))
            .EnsureSuccessStatusCode();

        var invited = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{created.SessionId}/summary", PaintJsonOptions);
        Assert.IsTrue(invited!.CanJoin);
        Assert.IsFalse(invited.IsParticipant);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await app.Bob.GetAsync(
                $"/paint/sessions/{created.SessionId}")).StatusCode);

        (await app.Bob.PostAsync(
            $"/paint/sessions/{created.SessionId}/join",
            null)).EnsureSuccessStatusCode();
        var joined = await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
            $"/paint/sessions/{created.SessionId}/summary", PaintJsonOptions);
        Assert.IsTrue(joined!.IsParticipant);

        await app.Manager.HandleSessionDisconnectedAsync(
            app.BobMumbleSessionId);
        app.ReconnectBobWithSession(app.BobMumbleSessionId + 100);

        var reconnected =
            await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
                $"/paint/sessions/{created.SessionId}/summary", PaintJsonOptions);
        Assert.IsTrue(reconnected!.CanJoin);
        Assert.IsFalse(reconnected.IsParticipant);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await app.Bob.GetAsync(
                $"/paint/sessions/{created.SessionId}")).StatusCode);

        (await app.Bob.PostAsync(
            $"/paint/sessions/{created.SessionId}/join",
            null)).EnsureSuccessStatusCode();
        Assert.IsTrue(
            (await app.Bob.GetFromJsonAsync<PaintSessionSummary>(
                $"/paint/sessions/{created.SessionId}/summary", PaintJsonOptions))!
            .IsParticipant);
    }

    private sealed class PaintIntegrationFixture : IAsyncDisposable
    {
        private static readonly byte[] ValidPng = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        private readonly WebApplication _app;
        private readonly TestPresence _presence;
        public long BobUserId { get; private init; }
        public int BobMumbleSessionId { get; private set; }
        public PaintSessionManager Manager =>
            _app.Services.GetRequiredService<PaintSessionManager>();
        public HttpClient Host { get; private set; } = null!;
        public HttpClient Bob { get; private set; } = null!;

        private PaintIntegrationFixture(WebApplication app, TestPresence presence)
        {
            _app = app;
            _presence = presence;
        }

        public void ReconnectBobWithSession(int mumbleSessionId)
        {
            var previous = _presence.Participants[BobUserId];
            _presence.Participants[BobUserId] = previous with
            {
                MumbleSessionId = mumbleSessionId,
            };
            BobMumbleSessionId = mumbleSessionId;
        }

        public static async Task<PaintIntegrationFixture> StartAsync()
        {
            var databasePath = Path.Combine(Path.GetTempPath(), $"paint-integration-{Guid.NewGuid():N}.db");
            var database = new Database($"Data Source={databasePath}");
            database.Initialize();
            var presence = new TestPresence();
            var matrix = new TestMatrix();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton(database);
            builder.Services.Configure<MatrixSettings>(settings => settings.ServerDomain = "test");
            builder.Services.AddSingleton<UserRepository>();
            builder.Services.AddSingleton<ICertificateHashExtractor, HeaderCertificateHashExtractor>();
            builder.Services.AddSingleton<IPaintPresence>(presence);
            builder.Services.AddSingleton<IMatrixPaintService>(matrix);
            builder.Services.AddSingleton<IPaintEventPublisher, TestPublisher>();
            builder.Services.AddSingleton<MatrixPaintSourceResolver>();
            builder.Services.AddSingleton<PaintRateLimiter>();
            builder.Services.AddSingleton<PaintRoomCleanupRepository>();
            builder.Services.AddSingleton<PaintSessionManager>();
            var app = builder.Build();
            app.MapPaintEndpoints();
            await app.StartAsync();

            var users = app.Services.GetRequiredService<UserRepository>();
            var host = await users.Insert("host-cert", "host");
            var bob = await users.Insert("bob-cert", "bob");
            presence.Participants[host.Id] = new(host.Id, 5, 100, host.MatrixUserId);
            presence.Participants[bob.Id] = new(bob.Id, 5, 101, bob.MatrixUserId);
            matrix.SourceSender = host.MatrixUserId;
            matrix.Memberships[bob.MatrixUserId] = "join";

            var fixture = new PaintIntegrationFixture(app, presence)
            {
                BobUserId = bob.Id,
                BobMumbleSessionId = 101,
            };
            fixture.Host = app.GetTestClient();
            fixture.Host.DefaultRequestHeaders.Add("X-Test-Certificate", "host-cert");
            fixture.Bob = app.GetTestClient();
            fixture.Bob.DefaultRequestHeaders.Add("X-Test-Certificate", "bob-cert");
            return fixture;
        }

        public object ValidStroke() => new
        {
            correlationId = Guid.NewGuid(), generation = 0, tool = "pen", color = "#EF4444", width = 6,
            points = new[] { new { x = 0.1, y = 0.2, pressure = 0.5 } },
        };

        public async ValueTask DisposeAsync()
        {
            Host.Dispose();
            Bob.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        private sealed class HeaderCertificateHashExtractor : ICertificateHashExtractor
        {
            public string? GetCertHash(HttpContext context) => context.Request.Headers["X-Test-Certificate"].FirstOrDefault();
        }

        private sealed class TestPresence : IPaintPresence
        {
            public Dictionary<long, PaintPresenceParticipant> Participants { get; } = [];
            public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant) => Participants.TryGetValue(userId, out participant!);
            public bool TryGetParticipantByMumbleSessionId(int mumbleSessionId, out PaintPresenceParticipant participant)
            {
                participant = Participants.Values.SingleOrDefault(value => value.MumbleSessionId == mumbleSessionId)!;
                return participant is not null;
            }
            public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(value => value.ChannelId == channelId).ToArray();
        }

        private sealed class TestPublisher : IPaintEventPublisher
        {
            public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
            public Task PublishPreviewToUsersAsync(IReadOnlySet<long> userIds, Guid sessionId, long authorUserId, object message) => Task.CompletedTask;
            public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
        }

        private sealed class TestMatrix : IMatrixPaintService
        {
            public string SourceSender { get; set; } = null!;
            public Dictionary<string, string?> Memberships { get; } = [];
            public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken) => Task.FromResult("!paint:test");
            public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => Task.CompletedTask;
            public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken) => Task.FromResult(JsonDocument.Parse($"{{\"room_id\":\"!paint:test\",\"sender\":\"{SourceSender}\",\"type\":\"m.room.message\",\"content\":{{\"msgtype\":\"m.image\",\"url\":\"mxc://test/source\",\"info\":{{\"mimetype\":\"image/png\",\"size\":{ValidPng.Length}}}}}}}").RootElement.Clone());
            public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => Task.FromResult(Memberships.GetValueOrDefault(matrixUserId));
            public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken) => Task.FromResult(ValidPng);
            public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken) => Task.FromResult(new MatrixPaintRoomCleanupResult(true, "delete", null));
        }
    }
}
