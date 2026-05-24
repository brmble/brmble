using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Messages;
using Brmble.Server.Mumble;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;

namespace Brmble.Server.Tests.Integration;

internal class BrmbleServerFactory : WebApplicationFactory<Program>, IDisposable
{
    private readonly SqliteConnection _keepAlive;
    private readonly string _cs;
    private readonly string? _certHash;
    public Mock<IAclAuthorizationService> AclAuthorizationMock { get; } = new();
    public Mock<IAclSyncCoordinator> AclCoordinatorMock { get; } = new();
    public Mock<IMumbleAclService> MumbleAclMock { get; } = new();
    public Mock<ISessionMappingService> SessionMappingMock { get; } = new();
    public Mock<IMumbleRegistrationService> MumbleRegistrationMock { get; } = new();
    public Mock<IMatrixAppService> MatrixAppServiceMock { get; } = new();

    public BrmbleServerFactory(string? certHash = "testcerthash123")
    {
        _certHash = certHash;
        var dbName = "brmble_server_" + Guid.NewGuid().ToString("N");
        _cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(_cs);
        _keepAlive.Open();
        AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(It.IsAny<long>(), 0)).ReturnsAsync(true);
        var defaultSessionMapping = new SessionMappingService();
        SessionMappingMock.Setup(s => s.SetNameForSession(It.IsAny<string>(), It.IsAny<int>()))
            .Callback<string, int>(defaultSessionMapping.SetNameForSession);
        SessionMappingMock.Setup(s => s.RemoveSession(It.IsAny<int>()))
            .Callback<int>(defaultSessionMapping.RemoveSession);
        SessionMappingMock.Setup(s => s.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<long>(), It.IsAny<string>()))
            .Returns((int sessionId, string matrixUserId, string mumbleName, long userId, string companionId) =>
                defaultSessionMapping.TryAddMatrixUser(sessionId, matrixUserId, mumbleName, userId, companionId));
        SessionMappingMock.Setup(s => s.TryUpdateBrmbleStatus(It.IsAny<int>(), It.IsAny<bool>()))
            .Returns((int sessionId, bool isBrmbleClient) => defaultSessionMapping.TryUpdateBrmbleStatus(sessionId, isBrmbleClient));
        SessionMappingMock.Setup(s => s.TryUpdateCompanionId(It.IsAny<int>(), It.IsAny<string>()))
            .Returns((int sessionId, string companionId) => defaultSessionMapping.TryUpdateCompanionId(sessionId, companionId));
        SessionMappingMock.Setup(s => s.TryGetSessionId(It.IsAny<string>(), out It.Ref<int>.IsAny))
            .Returns((string mumbleName, out int sessionId) => defaultSessionMapping.TryGetSessionId(mumbleName, out sessionId));
        SessionMappingMock.Setup(s => s.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long userId, out int sessionId) => defaultSessionMapping.TryGetSessionByUserId(userId, out sessionId));
        SessionMappingMock.Setup(s => s.TryGetMappingByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long userId, out int sessionId, out SessionMapping? mapping) =>
                defaultSessionMapping.TryGetMappingByUserId(userId, out sessionId, out mapping));
        SessionMappingMock.Setup(s => s.TryGetMatrixUserId(It.IsAny<int>(), out It.Ref<string?>.IsAny))
            .Returns((int sessionId, out string? matrixUserId) => defaultSessionMapping.TryGetMatrixUserId(sessionId, out matrixUserId));
        SessionMappingMock.Setup(s => s.GetSnapshot()).Returns(defaultSessionMapping.GetSnapshot);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(config =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                ["Matrix:HomeserverUrl"] = "http://localhost:8008",
                ["Matrix:AppServiceToken"] = "test-token",
                ["LiveKit:ApiKey"] = "test-api-key",
                ["LiveKit:ApiSecret"] = "testsecret0123456789abcdef01234567890abcdef01234567890abcdef0123",
            });
        });
        builder.ConfigureServices(services =>
        {
            // Replace the lazily-registered Database factory with a concrete in-memory instance.
            var descriptor = services.FirstOrDefault(d => d.ServiceType == typeof(Database));
            if (descriptor != null) services.Remove(descriptor);
            var db = new Database(_cs);
            db.Initialize();
            services.AddSingleton(db);

            // Stub IMatrixAppService so no real HTTP calls are made
            var existing = services.FirstOrDefault(d => d.ServiceType == typeof(IMatrixAppService));
            if (existing != null) services.Remove(existing);
            MatrixAppServiceMock.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync("stub_matrix_token");
            MatrixAppServiceMock.Setup(m => m.LoginUser(It.IsAny<string>()))
                .ReturnsAsync("stub_matrix_token");
            MatrixAppServiceMock.Setup(m => m.GetRoomEventAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((MatrixTimelineEventInfo?)null);
            MatrixAppServiceMock.Setup(m => m.RedactEventAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync("$redaction:example.com");
            services.AddSingleton<IMatrixAppService>(MatrixAppServiceMock.Object);

            // Stub ICertificateHashExtractor — WebApplicationFactory bypasses TLS so
            // context.Connection.ClientCertificate is always null in tests.
            var extDesc = services.FirstOrDefault(d => d.ServiceType == typeof(ICertificateHashExtractor));
            if (extDesc != null) services.Remove(extDesc);
            var mockExt = new Mock<ICertificateHashExtractor>();
            mockExt.Setup(e => e.GetCertHash(It.IsAny<HttpContext>())).Returns(_certHash);
            services.AddSingleton<ICertificateHashExtractor>(mockExt.Object);

            var aclAuth = services.FirstOrDefault(d => d.ServiceType == typeof(IAclAuthorizationService));
            if (aclAuth != null) services.Remove(aclAuth);
            services.AddSingleton(AclAuthorizationMock.Object);

            var aclSync = services.FirstOrDefault(d => d.ServiceType == typeof(IAclSyncCoordinator));
            if (aclSync != null) services.Remove(aclSync);
            services.AddSingleton(AclCoordinatorMock.Object);

            var aclService = services.FirstOrDefault(d => d.ServiceType == typeof(IMumbleAclService));
            if (aclService != null) services.Remove(aclService);
            services.AddSingleton(MumbleAclMock.Object);

            var sessionMapping = services.FirstOrDefault(d => d.ServiceType == typeof(ISessionMappingService));
            if (sessionMapping != null) services.Remove(sessionMapping);
            services.AddSingleton(SessionMappingMock.Object);

            var registration = services.FirstOrDefault(d => d.ServiceType == typeof(IMumbleRegistrationService));
            if (registration != null) services.Remove(registration);
            services.AddSingleton(MumbleRegistrationMock.Object);
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _keepAlive.Dispose();
        base.Dispose(disposing);
    }
}
