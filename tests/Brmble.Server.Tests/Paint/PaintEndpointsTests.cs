using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintEndpointsTests
{
    [TestMethod]
    public void MapPaintEndpoints_MapsSourceDownloadAndSessionRoutes()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Services.AddSingleton<ICertificateHashExtractor>(new TestCertificate());
        builder.Services.AddSingleton<UserRepository>();
        builder.Services.AddSingleton<IPaintPresence>(new TestPresence());
        builder.Services.AddSingleton<PaintSessionManager>();
        var app = builder.Build();
        app.MapPaintEndpoints();

        var routes = ((IEndpointRouteBuilder)app).DataSources.SelectMany(x => x.Endpoints)
            .OfType<RouteEndpoint>().Select(x => x.RoutePattern.RawText).ToArray();
        CollectionAssert.Contains(routes, "/paint/sessions/{id:guid}/source");
        CollectionAssert.Contains(routes, "/paint/sessions/{id:guid}/summary");
    }

    [TestMethod]
    public async Task CreateSession_AcceptsBase64SourceAndReturnsOnlyTheCurrentSessionIdentifiers()
    {
        await using var app = await EndpointFixture.StartAsync();
        var payload = new
        {
            channelId = 9,
            source = new { mimeType = "image/png", dataBase64 = Convert.ToBase64String(EndpointFixture.ValidPng) },
        };

        var response = await app.Client.PostAsJsonAsync("/paint/sessions", payload);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var propertyNames = json.RootElement.EnumerateObject().Select(property => property.Name).ToArray();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        CollectionAssert.AreEquivalent(new[] { "sessionId", "channelId" }, propertyNames);
        Assert.AreEqual(9, json.RootElement.GetProperty("channelId").GetInt32());
    }

    [TestMethod]
    public async Task CreateSession_RejectsMalformedBase64AndMissingSource()
    {
        await using var app = await EndpointFixture.StartAsync();

        var malformed = await app.Client.PostAsJsonAsync("/paint/sessions", new { channelId = 9, source = new { mimeType = "image/png", dataBase64 = "not-base64" } });
        var missing = await app.Client.PostAsJsonAsync("/paint/sessions", new { channelId = 9 });

        Assert.AreEqual(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, missing.StatusCode);
    }

    [TestMethod]
    public async Task GetSource_UserOutsideChannelGetsForbidden()
    {
        await using var app = await EndpointFixture.StartAsync();
        app.Presence.Participants[app.InviteeId] = new(app.InviteeId, 12, 102, "@alice:test");
        app.SetCertificateHash("alice-cert");

        var response = await app.Client.GetAsync($"/paint/sessions/{app.SessionId}/source");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task GetSource_JoinedParticipantReceivesMetadataAndBytes()
    {
        await using var app = await EndpointFixture.StartAsync();
        var manager = app.Services.GetRequiredService<PaintSessionManager>();
        await manager.JoinAsync(app.SessionId, app.InviteeId);
        app.SetCertificateHash("alice-cert");

        var response = await app.Client.GetAsync($"/paint/sessions/{app.SessionId}/source");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("image/png", body.GetProperty("mimeType").GetString());
        CollectionAssert.AreEqual(EndpointFixture.ValidPng, Convert.FromBase64String(body.GetProperty("dataBase64").GetString()!));
    }

    [TestMethod]
    public async Task GetSource_EndedSessionReturnsConflict()
    {
        await using var app = await EndpointFixture.StartAsync();
        await app.Services.GetRequiredService<PaintSessionManager>().EndAsync(app.SessionId, app.HostId);

        var response = await app.Client.GetAsync($"/paint/sessions/{app.SessionId}/source");

        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
    }

    private sealed class EndpointFixture : IAsyncDisposable
    {
        public static readonly byte[] ValidPng = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        private readonly WebApplication _app;
        private readonly TestCertificate _certificate;
        public HttpClient Client { get; }
        public TestPresence Presence { get; }
        public long HostId { get; private set; }
        public long InviteeId { get; private set; }
        public Guid SessionId { get; private set; }
        public IServiceProvider Services => _app.Services;

        private EndpointFixture(WebApplication app, TestCertificate certificate, TestPresence presence)
        { _app = app; _certificate = certificate; Presence = presence; Client = app.GetTestClient(); }
        public void SetCertificateHash(string? value) => _certificate.Hash = value;

        public static async Task<EndpointFixture> StartAsync()
        {
            var database = new Database($"Data Source={Path.Combine(Path.GetTempPath(), $"paint-endpoints-{Guid.NewGuid():N}.db")}");
            database.Initialize();
            var presence = new TestPresence();
            var certificate = new TestCertificate();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton(database);
            builder.Services.AddSingleton<UserRepository>();
            builder.Services.AddSingleton<ICertificateHashExtractor>(certificate);
            builder.Services.AddSingleton<IPaintPresence>(presence);
            builder.Services.AddSingleton<IPaintEventPublisher, TestPublisher>();
            builder.Services.AddSingleton<IPaintTemporarySourceStore, TestSourceStore>();
            builder.Services.AddSingleton<PaintSourceValidator>();
            builder.Services.AddSingleton<PaintTemporaryCleanupRepository>();
            builder.Services.AddSingleton<PaintRateLimiter>();
            builder.Services.AddSingleton<PaintSessionManager>();
            var app = builder.Build(); app.MapPaintEndpoints(); await app.StartAsync();
            var fixture = new EndpointFixture(app, certificate, presence);
            var users = app.Services.GetRequiredService<UserRepository>();
            var host = await users.Insert("bob-cert", "bob");
            var invitee = await users.Insert("alice-cert", "alice");
            fixture.HostId = host.Id; fixture.InviteeId = invitee.Id;
            presence.Participants[host.Id] = new(host.Id, 9, 101, "@bob:test");
            presence.Participants[invitee.Id] = new(invitee.Id, 9, 102, "@alice:test");
            fixture.SessionId = (await app.Services.GetRequiredService<PaintSessionManager>().CreateAsync(host.Id, "image/png", ValidPng, CancellationToken.None)).SessionId;
            return fixture;
        }

        public async ValueTask DisposeAsync() { Client.Dispose(); await _app.StopAsync(); await _app.DisposeAsync(); }
    }

    private sealed class TestCertificate : ICertificateHashExtractor
    { public string? Hash { get; set; } = "bob-cert"; public string? GetCertHash(HttpContext context) => Hash; }
    private sealed class TestPresence : IPaintPresence
    {
        public Dictionary<long, PaintPresenceParticipant> Participants { get; } = [];
        public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant) => Participants.TryGetValue(userId, out participant!);
        public bool TryGetParticipantByMumbleSessionId(int id, out PaintPresenceParticipant participant) { participant = Participants.Values.SingleOrDefault(x => x.MumbleSessionId == id)!; return participant is not null; }
        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(x => x.ChannelId == channelId).ToArray();
    }
    private sealed class TestPublisher : IPaintEventPublisher
    { public Task PublishToUsersAsync(IReadOnlySet<long> ids, object message) => Task.CompletedTask; public Task PublishPreviewToUsersAsync(IReadOnlySet<long> ids, Guid sessionId, long author, object message) => Task.CompletedTask; public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask; }
    private sealed class TestSourceStore : IPaintTemporarySourceStore
    {
        private readonly Dictionary<Guid, byte[]> _sources = [];
        public Task WriteAsync(Guid id, ReadOnlyMemory<byte> bytes, CancellationToken token) { _sources[id] = bytes.ToArray(); return Task.CompletedTask; }
        public Task<byte[]> ReadAsync(Guid id, CancellationToken token) => Task.FromResult(_sources[id]);
        public Task DeleteAsync(Guid id, CancellationToken token) { _sources.Remove(id); return Task.CompletedTask; }
        public Task<IReadOnlyList<Guid>> ListSessionIdsAsync(CancellationToken token) => Task.FromResult<IReadOnlyList<Guid>>(_sources.Keys.ToArray());
    }
}
