using System.Net;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Mumble;
using Brmble.Server.Data;
using Dapper;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthTokenTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public AuthTokenTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostAuthToken_NoClientCert_ReturnsUnauthorized()
    {
        // Factory configured with certHash: null simulates no client certificate
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await client.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAuthToken_WithClientCert_ReturnsCredentialsShape()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("homeserverUrl"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("accessTokenExpiresAt"));
        Assert.IsTrue(json.Contains("accessTokenRefreshAt"));
        Assert.IsTrue(json.Contains("userId"));
        Assert.IsTrue(json.Contains("roomMap"));
    }

    [TestMethod]
    public async Task PostAuthToken_WithClientCert_IncludesUserMappings()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("userMappings"), "Response should contain userMappings field");
    }

    [TestMethod]
    public async Task PostAuthToken_StartupMigratesLegacyTokenBeforeRotatingIt()
    {
        using var factory = new BrmbleServerFactory(seedLegacyToken: true);
        using var client = factory.CreateClient();

        using (var conn = factory.Services.GetRequiredService<Database>().CreateConnection())
        {
            var row = await conn.QuerySingleAsync<(string Token, long ExpiresAt)>("""
                SELECT matrix_access_token AS Token, token_expires_at AS ExpiresAt
                FROM users WHERE id = @UserId
                """, new { UserId = factory.AliceUserId });
            StringAssert.StartsWith(row.Token, "dp:v1:");
            Assert.AreNotEqual("matrix-legacy-startup-SENTINEL-347", row.Token);
            Assert.IsTrue(row.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(json, "stub_matrix_token");
        Assert.IsFalse(json.Contains("dp:v1:", StringComparison.Ordinal));

        var invocations = factory.Matrix.Mock.Invocations
            .Select(invocation => invocation.Method.Name)
            .ToArray();
        CollectionAssert.AreEqual(new[] { "RevokeAccessToken", "LoginUser" }, invocations.Take(2).ToArray());
        factory.Matrix.Mock.Verify(
            matrix => matrix.RevokeAccessToken(
                "matrix-legacy-startup-SENTINEL-347", It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [TestMethod]
    public async Task PostAuthToken_IncludesSessionMappingsInResponse()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("sessionMappings"), "Response should contain sessionMappings field");
    }

    [TestMethod]
    public async Task PostAuthToken_SessionMappings_IncludeIsBrmbleClient()
    {
        // Seed a session mapping with isBrmbleClient = true before authenticating
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("OtherUser", 42);
        sessionMapping.TryAddMatrixUser(42, "@other:localhost", "OtherUser", 999, "bee");
        sessionMapping.TryUpdateBrmbleStatus(42, true);

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.IsTrue(root.TryGetProperty("sessionMappings", out var mappings),
            "Response should contain sessionMappings");

        // Find the seeded session mapping and verify isBrmbleClient round-trips as true
        Assert.IsTrue(mappings.TryGetProperty("42", out var entry),
            "sessionMappings should contain session 42");
        Assert.IsTrue(entry.TryGetProperty("isBrmbleClient", out var isBrmble),
            "Session mapping entry should contain isBrmbleClient");
        Assert.IsTrue(isBrmble.GetBoolean(),
            "isBrmbleClient should be true for the seeded Brmble client");
    }

    [TestMethod]
    public async Task PostAuthToken_SessionMappings_IncludeCompanionId()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("OtherUser", 42);
        sessionMapping.TryAddMatrixUser(42, "@other:localhost", "OtherUser", 999, "retro");

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var companionId = root
            .GetProperty("sessionMappings")
            .GetProperty("42")
            .GetProperty("companionId")
            .GetString();

        Assert.AreEqual("retro", companionId);
    }

    [TestMethod]
    public async Task PostAuthToken_SessionMappings_IncludeCertHash()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("OtherUser", 42);
        sessionMapping.TryAddMatrixUser(42, "@other:localhost", "OtherUser", 999, "retro");
        sessionMapping.TryUpdateCertHash(42, "cert-other");

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var certHash = doc.RootElement
            .GetProperty("sessionMappings")
            .GetProperty("42")
            .GetProperty("certHash")
            .GetString();

        Assert.AreEqual("cert-other", certHash);
    }

    [TestMethod]
    public async Task PostAuthToken_SelfSession_IsBrmbleClient_True()
    {
        // Verify that the authenticating user's own session gets isBrmbleClient = true
        // even when the mapping was created with IsBrmbleClient = false (race condition fix)
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        // Pre-seed the name→session mapping so the endpoint can find the session
        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("Alice", 1);

        // Authenticate with a mumbleUsername so the endpoint can resolve the session
        var body = new StringContent(
            JsonSerializer.Serialize(new { mumbleUsername = "Alice" }),
            Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/auth/token", body);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.IsTrue(root.TryGetProperty("sessionMappings", out var mappings),
            "Response should contain sessionMappings");
        Assert.IsTrue(mappings.TryGetProperty("1", out var entry),
            "sessionMappings should contain session 1 (self)");
        Assert.IsTrue(entry.TryGetProperty("isBrmbleClient", out var isBrmble),
            "Session mapping entry should contain isBrmbleClient");
        Assert.IsTrue(isBrmble.GetBoolean(),
            "Self session should have isBrmbleClient = true after auth");
    }

    [TestMethod]
    public async Task PostAuthToken_StampsResponseWithEnvelope()
    {
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.IsTrue(doc.RootElement.TryGetProperty("instanceId", out var instanceId),
            "/auth/token is the bootstrap snapshot transport and must be orderable");
        Assert.IsFalse(string.IsNullOrWhiteSpace(instanceId.GetString()));
        Assert.IsTrue(doc.RootElement.TryGetProperty("revision", out _));
    }

    [TestMethod]
    public async Task PostAuthToken_NewMappingBroadcastsStampedUserMappingAdded()
    {
        // The endpoint bumps the revision three times (add, certHash, brmbleStatus) before
        // announcing. An unstamped announcement makes all three bumps silent.
        using var factory = new RecordingBusFactory();
        using var client = factory.CreateClient();
        factory.Services.GetRequiredService<ISessionMappingService>()
            .SetNameForSession("Alice", 1);

        var body = new StringContent(
            JsonSerializer.Serialize(new { mumbleUsername = "Alice" }),
            Encoding.UTF8, "application/json");
        (await client.PostAsync("/auth/token", body)).EnsureSuccessStatusCode();

        var payload = factory.Broadcasts
            .Single(p => JsonSerializer.Serialize(p).Contains("\"type\":\"userMappingAdded\""));
        Events.MappingPayloadEnvelopeTests.AssertHasEnvelope(payload, "userMappingAdded");
    }

    /// <summary>Swaps the real event bus for one that records broadcasts.</summary>
    private sealed class RecordingBusFactory : BrmbleServerFactory
    {
        public List<object> Broadcasts { get; } = new();

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                var existing = services.FirstOrDefault(d => d.ServiceType == typeof(IBrmbleEventBus));
                if (existing is not null) services.Remove(existing);
                var bus = new Moq.Mock<IBrmbleEventBus>();
                bus.Setup(b => b.BroadcastAsync(Moq.It.IsAny<object>()))
                    .Callback<object>(m => { lock (Broadcasts) Broadcasts.Add(m); })
                    .Returns(Task.CompletedTask);
                services.AddSingleton(bus.Object);
            });
        }
    }

    [TestMethod]
    public async Task PostAuthToken_IncludesPasswordProtectedChannelIdsWithoutTokenPlaintext()
    {
        var snapshots = _factory.Services.GetRequiredService<IAclSnapshotRepository>();
        await snapshots.UpsertAsync(new AclChannelSnapshotDto(
            ChannelId: 5,
            InheritAcls: true,
            Groups: [],
            Acls: [new AclRuleDto(true, false, false, null, "__brmble_password_marker__:#secret-token", 0, 0)],
            FetchedAt: DateTimeOffset.UtcNow,
            Stale: false,
            Warning: null));

        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var ids = doc.RootElement.GetProperty("passwordProtectedChannelIds").EnumerateArray().Select(e => e.GetInt32()).ToArray();

        CollectionAssert.AreEqual(new[] { 5 }, ids);
        Assert.IsFalse(json.Contains("secret-token", StringComparison.Ordinal));
    }
}
