using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Brmble.Server.Matrix;
using Brmble.Server.Events;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintEndpointsTests
{
    [TestMethod]
    public void PaintEventNames_MatchCanonicalContract()
    {
        var expected = new[]
        {
            "paint.sourceAttached", "paint.invited", "paint.participantJoined", "paint.participantLeft",
            "paint.previewUpdated", "paint.strokeCommitted", "paint.strokeUndone", "paint.canvasCleared",
            "paint.sessionEnded", "paint.sessionExpired", "paint.sessionUnavailable",
        };

        CollectionAssert.AreEquivalent(expected, PaintEventNames.BroadcastEvents.ToArray());
    }

    [TestMethod]
    public void MapPaintEndpoints_MapsAllContractRoutes()
    {
        var endpoints = MapRoutesForTest();

        CollectionAssert.IsSubsetOf(new[]
        {
            "/paint/sessions", "/paint/sessions/{id:guid}/source", "/paint/sessions/{id:guid}/summary",
            "/paint/sessions/{id:guid}", "/paint/sessions/{id:guid}/join", "/paint/sessions/{id:guid}/leave",
            "/paint/sessions/{id:guid}/stroke", "/paint/sessions/{id:guid}/preview", "/paint/sessions/{id:guid}/undo",
            "/paint/sessions/{id:guid}/clear", "/paint/sessions/{id:guid}/end",
        }, endpoints.ToArray());
    }

    [TestMethod]
    public void MapPaintEndpoints_MapsSummaryRoute()
    {
        var endpoints = MapRoutesForTest();

        CollectionAssert.Contains(
            endpoints.ToArray(),
            "/paint/sessions/{id:guid}/summary");
    }

    [TestMethod]
    public async Task Join_IsIdempotentForCurrentHost()
    {
        await using var app = await EndpointFixture.StartAsync();

        var response = await app.Client.PostAsync(
            $"/paint/sessions/{app.SessionId}/join",
            null);

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task Join_RejectsInviteeWithoutMatrixMembership()
    {
        await using var app =
            await EndpointFixture.StartActiveInviteeAsync();

        var response = await app.Client.PostAsync(
            $"/paint/sessions/{app.SessionId}/join",
            null);

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content
            .ReadFromJsonAsync<PaintErrorDto>();
        Assert.AreEqual("MATRIX_MEMBERSHIP_REQUIRED", body!.Code);
    }

    [TestMethod]
    public async Task Summary_DoesNotExposeParticipantOnlyState()
    {
        await using var app = await EndpointFixture.StartActiveInviteeAsync();

        var response = await app.Client.GetAsync(
            $"/paint/sessions/{app.SessionId}/summary");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.IsTrue(body.GetProperty("canJoin").GetBoolean());
        Assert.IsFalse(body.GetProperty("isParticipant").GetBoolean());
        Assert.AreEqual("active", body.GetProperty("status").GetString());
        Assert.IsFalse(body.TryGetProperty("matrixRoomId", out _));
        Assert.IsFalse(body.TryGetProperty("source", out _));
        Assert.IsFalse(body.TryGetProperty("participants", out _));
        Assert.IsFalse(body.TryGetProperty("strokes", out _));
    }

    [TestMethod]
    public async Task Snapshot_SerializesStatusAsFrontendContractString()
    {
        await using var app = await EndpointFixture.StartActiveAsync();

        var response = await app.Client.GetAsync(
            $"/paint/sessions/{app.SessionId}");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual("active", body.GetProperty("status").GetString());
    }

    [TestMethod]
    public async Task Snapshot_RejectsInviteeBeforeExplicitJoin()
    {
        await using var app = await EndpointFixture.StartActiveInviteeAsync();

        var response = await app.Client.GetAsync(
            $"/paint/sessions/{app.SessionId}");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PaintErrorDto>();
        Assert.AreEqual("PARTICIPANT_REQUIRED", body!.Code);
    }

    private static IReadOnlyCollection<string> MapRoutesForTest()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Services.AddSingleton(new Mock<ICertificateHashExtractor>().Object);
        builder.Services.AddSingleton<UserRepository>();
        builder.Services.AddSingleton<IPaintPresence>(new TestPaintPresence());
        builder.Services.AddSingleton<PaintSessionManager>();
        var app = builder.Build();

        app.MapPaintEndpoints();
        return ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .Where(route => route is not null)
            .Select(route => route!)
            .ToHashSet(StringComparer.Ordinal);
    }

    [TestMethod]
    public async Task Snapshot_RejectsUnauthenticatedRequestWithStableErrorShape()
    {
        await using var app = await EndpointFixture.StartAsync();
        app.SetCertificateHash(null);

        var response = await app.Client.GetAsync($"/paint/sessions/{app.SessionId}");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PaintErrorDto>();
        Assert.IsNotNull(body);
        Assert.AreEqual("UNAUTHENTICATED", body.Code);
        Assert.IsFalse(string.IsNullOrWhiteSpace(body.Error));
    }

    [TestMethod]
    public async Task Create_MapsGenericAuthorizationFailureToPaintForbidden()
    {
        await using var app = await EndpointFixture.StartAsync();

        var response = await app.Client.PostAsJsonAsync("/paint/sessions", new { channelId = 10 });

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PaintErrorDto>();
        Assert.IsNotNull(body);
        Assert.AreEqual("PAINT_FORBIDDEN", body.Code);
        Assert.IsFalse(string.IsNullOrWhiteSpace(body.Error));
    }

    [TestMethod]
    public async Task Stroke_ReturnsCreatedStrokeAndRevision()
    {
        await using var app = await EndpointFixture.StartActiveAsync();
        var response = await app.Client.PostAsJsonAsync($"/paint/sessions/{app.SessionId}/stroke", new
        {
            correlationId = Guid.Parse("11111111-1111-1111-1111-111111111111"), generation = 0,
            tool = "pen", color = "#EF4444", width = 6,
            points = new[] { new { x = 0.1, y = 0.2, pressure = 0.5 } },
        });
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.IsTrue(body.TryGetProperty("stroke", out _));
        Assert.AreEqual(2, body.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public async Task Stroke_AcceptsNumericBrushWidthAndRejectsInvalidWidth()
    {
        await using var app = await EndpointFixture.StartActiveAsync();

        var good = await app.Client.PostAsJsonAsync($"/paint/sessions/{app.SessionId}/stroke", new
        {
            correlationId = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            generation = 0,
            tool = "pen",
            color = "#EF4444",
            width = 3,
            points = new[] { new { x = 0.1, y = 0.2 } },
        });
        Assert.AreEqual(HttpStatusCode.Created, good.StatusCode);

        var bad = await app.Client.PostAsJsonAsync($"/paint/sessions/{app.SessionId}/stroke", new
        {
            correlationId = Guid.Parse("22222222-2222-2222-2222-222222222222"),
            generation = 0,
            tool = "pen",
            color = "#EF4444",
            width = 5,
            points = new[] { new { x = 0.1, y = 0.2 } },
        });
        Assert.AreEqual(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("{")]
    public async Task Stroke_RejectsMalformedOrMissingBodyWithStableErrorShape(string body)
    {
        await using var app = await EndpointFixture.StartActiveAsync();
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        var response = await app.Client.PostAsync($"/paint/sessions/{app.SessionId}/stroke", content);

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<PaintErrorDto>();
        Assert.IsNotNull(error);
        Assert.AreEqual("INVALID_REQUEST", error.Code);
        Assert.IsFalse(string.IsNullOrWhiteSpace(error.Error));
    }

    private sealed record PaintErrorDto(string Code, string Error);

    private sealed class EndpointFixture : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly Database _database;
        private readonly TestPresence _presence;
        private readonly TestMatrix _matrix;
        private readonly TestCertificate _certificate;
        public HttpClient Client { get; }
        public Guid SessionId { get; private set; }

        private EndpointFixture(WebApplication app, Database database, TestPresence presence, TestMatrix matrix, TestCertificate certificate)
        {
            _app = app; _database = database; _presence = presence; _matrix = matrix; _certificate = certificate; Client = app.GetTestClient();
        }

        public void SetCertificateHash(string? hash) => _certificate.Hash = hash;

        public static async Task<EndpointFixture> StartAsync()
        {
            var database = new Database($"Data Source={Path.Combine(Path.GetTempPath(), $"paint-endpoints-{Guid.NewGuid():N}.db")}");
            database.Initialize();
            var presence = new TestPresence();
            var matrix = new TestMatrix();
            var certificate = new TestCertificate();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton(database);
            builder.Services.Configure<MatrixSettings>(x => x.ServerDomain = "test");
            builder.Services.AddSingleton<UserRepository>();
            builder.Services.AddSingleton<ICertificateHashExtractor>(certificate);
            builder.Services.AddSingleton<IPaintPresence>(presence);
            builder.Services.AddSingleton<IMatrixPaintService>(matrix);
            builder.Services.AddSingleton<IPaintEventPublisher, TestPublisher>();
            builder.Services.AddSingleton<MatrixPaintSourceResolver>();
            builder.Services.AddSingleton<PaintRateLimiter>();
            builder.Services.AddSingleton<PaintRoomCleanupRepository>();
            builder.Services.AddSingleton<PaintSessionManager>();
            var app = builder.Build(); app.MapPaintEndpoints(); await app.StartAsync();
            var fixture = new EndpointFixture(app, database, presence, matrix, certificate);
            var users = app.Services.GetRequiredService<UserRepository>();
            var host = await users.Insert("bob-cert", "bob");
            var invitee = await users.Insert("alice-cert", "alice");
            presence.Participants[host.Id] = new(host.Id, 9, 101, host.MatrixUserId);
            presence.Participants[invitee.Id] = new(invitee.Id, 9, 102, invitee.MatrixUserId);
            fixture.SessionId = (await app.Services.GetRequiredService<PaintSessionManager>().CreateAsync(host.Id, [102])).SessionId;
            return fixture;
        }

        public static async Task<EndpointFixture> StartActiveInviteeAsync()
        {
            var fixture = await StartAsync();
            var users =
                fixture._app.Services.GetRequiredService<UserRepository>();
            var host = await users.GetByCertHash("bob-cert");
            var manager =
                fixture._app.Services.GetRequiredService<PaintSessionManager>();
            await manager.AttachSourceAsync(
                fixture.SessionId,
                host!.Id,
                "$source");
            fixture.SetCertificateHash("alice-cert");
            return fixture;
        }

        public static async Task<EndpointFixture> StartActiveAsync()
        {
            var fixture = await StartAsync();
            var users = fixture._app.Services.GetRequiredService<UserRepository>();
            var user = await users.GetByCertHash("bob-cert");
            var manager = fixture._app.Services.GetRequiredService<PaintSessionManager>();
            await manager.AttachSourceAsync(fixture.SessionId, user!.Id, "$source");
            fixture._matrix.Memberships[user.MatrixUserId] = "join";
            await manager.JoinAsync(fixture.SessionId, user.Id);
            return fixture;
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose(); await _app.StopAsync(); await _app.DisposeAsync();
        }
    }

    private sealed class TestCertificate : ICertificateHashExtractor
    {
        public string? Hash { get; set; } = "bob-cert";
        public string? GetCertHash(HttpContext context) => Hash;
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
        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(x => x.ChannelId == channelId).ToArray();
    }

    private sealed class TestPublisher : IPaintEventPublisher
    {
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
        public Task PublishPreviewToUsersAsync(IReadOnlySet<long> userIds, Guid sessionId, long authorUserId, object message) => Task.CompletedTask;
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
    }

    private sealed class TestMatrix : IMatrixPaintService
    {
        private static readonly byte[] ValidPng = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        public Dictionary<string, string?> Memberships { get; } = [];
        public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> ids, CancellationToken token) => Task.FromResult("!paint:test");
        public Task InvitePaintUserAsync(string roomId, string id, CancellationToken token) => Task.CompletedTask;
        public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken token) => Task.FromResult(JsonDocument.Parse($"{{\"room_id\":\"!paint:test\",\"sender\":\"@1:test\",\"type\":\"m.room.message\",\"content\":{{\"msgtype\":\"m.image\",\"url\":\"mxc://test/image\",\"info\":{{\"mimetype\":\"image/png\",\"size\":{ValidPng.Length}}}}}}}").RootElement.Clone());
        public Task<string?> GetMembershipAsync(string roomId, string id, CancellationToken token) => Task.FromResult(Memberships.GetValueOrDefault(id));
        public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken token) => Task.FromResult(ValidPng);
        public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken token) => Task.FromResult(new MatrixPaintRoomCleanupResult(true, "delete", null));
    }

    private sealed class TestPaintPresence : IPaintPresence
    {
        public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant)
        {
            participant = null!;
            return false;
        }

        public bool TryGetParticipantByMumbleSessionId(int mumbleSessionId, out PaintPresenceParticipant participant)
        {
            participant = null!;
            return false;
        }

        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => [];
    }
}
