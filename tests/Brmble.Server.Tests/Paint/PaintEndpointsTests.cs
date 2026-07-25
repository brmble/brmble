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
            "paint.sessionEnded", "paint.sessionExpired", "paint.sessionUnavailable", "paint.roomCleanupFailed",
        };

        CollectionAssert.AreEquivalent(expected, PaintEventNames.BroadcastEvents.ToArray());
    }

    [TestMethod]
    public void MapPaintEndpoints_MapsAllContractRoutes()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Services.AddSingleton(new Mock<ICertificateHashExtractor>().Object);
        builder.Services.AddSingleton<UserRepository>();
        builder.Services.AddSingleton<IPaintPresence>(new TestPaintPresence());
        builder.Services.AddSingleton<PaintSessionManager>();
        var app = builder.Build();

        app.MapPaintEndpoints();

        var endpoints = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .ToHashSet(StringComparer.Ordinal);

        CollectionAssert.IsSubsetOf(new[]
        {
            "/paint/sessions", "/paint/sessions/{id:guid}/source", "/paint/sessions/{id:guid}",
            "/paint/sessions/{id:guid}/join", "/paint/sessions/{id:guid}/leave", "/paint/sessions/{id:guid}/stroke",
            "/paint/sessions/{id:guid}/preview", "/paint/sessions/{id:guid}/undo", "/paint/sessions/{id:guid}/clear",
            "/paint/sessions/{id:guid}/end",
        }, endpoints.ToArray());
    }

    [TestMethod]
    public async Task Join_RejectsUserWithoutMatrixMembership()
    {
        await using var app = await EndpointFixture.StartAsync();
        var response = await app.Client.PostAsJsonAsync($"/paint/sessions/{app.SessionId}/join", new { });
        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PaintErrorDto>();
        Assert.IsNotNull(body);
        Assert.AreEqual("MATRIX_MEMBERSHIP_REQUIRED", body.Code);
        Assert.IsFalse(string.IsNullOrWhiteSpace(body.Error));
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
        Assert.AreEqual(3, body.GetProperty("revision").GetInt64());
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
            var user = await app.Services.GetRequiredService<UserRepository>().Insert("bob-cert", "bob");
            presence.Participants[user.Id] = new(user.Id, 9, 101, user.MatrixUserId);
            fixture.SessionId = (await app.Services.GetRequiredService<PaintSessionManager>().CreateAsync(user.Id, [])).SessionId;
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
        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(x => x.ChannelId == channelId).ToArray();
    }

    private sealed class TestPublisher : IPaintEventPublisher
    {
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
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

        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => [];
    }
}
