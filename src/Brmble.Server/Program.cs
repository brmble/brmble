using Brmble.Server;
using Brmble.Server.Auth;
using Brmble.Server.ChannelRequests;
using Brmble.Server.DM;
using Brmble.Server.Games;
using Brmble.Server.Middleware;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Brmble.Server.ServerInfo;
using Brmble.Server.WebSockets;
using Brmble.Server.Paint;
using Brmble.Server.Companions;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Listen on HTTPS port 8080. Port mapping to the outside world is handled by Docker.
// Client certificates are accepted without CA validation (Mumble self-signed certs).
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(8080, listen =>
    {
        listen.UseHttps(ServerCertificate.Get(), https =>
        {
            https.ClientCertificateMode = ClientCertificateMode.AllowCertificate;
            https.ClientCertificateValidation = (_, _, _) => true;
        });
    });
});

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo("/data/dataprotection-keys"));

builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddMumble();
builder.Services.AddAuth();
builder.Services.AddMatrix();
builder.Services.AddLiveKit();
builder.Services.AddGames();
builder.Services.AddCustomCompanions();
builder.Services.AddSingleton<IMatrixPaintService, MatrixPaintService>();
builder.Services.AddSingleton<MatrixPaintSourceResolver>();
builder.Services.AddSingleton<IPaintPresence, SessionMappingPaintPresence>();
builder.Services.AddSingleton<IPaintEventPublisher, BrmblePaintEventPublisher>();
builder.Services.AddSingleton<PaintRateLimiter>();
builder.Services.AddSingleton<PaintRoomCleanupRepository>();
builder.Services.AddSingleton<PaintSessionManager>();
builder.Services.AddSingleton<IPaintParticipationLifecycle>(services =>
    services.GetRequiredService<PaintSessionManager>());
builder.Services.AddHostedService<PaintSessionExpirationService>();
builder.Services.AddHostedService<PaintRoomCleanupService>();
builder.Services.AddOptions<ServerInfoSettings>()
    .BindConfiguration("ServerInfo");
builder.Services.AddSingleton<IServerVersionProvider, ServerVersionProvider>();
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Per-client partition key so one client's requests can't starve others.
    // These endpoints require a client certificate; fall back to remote IP.
    static string LiveKitPartitionKey(HttpContext ctx) =>
        ctx.Connection.ClientCertificate?.Thumbprint
        ?? ctx.Connection.RemoteIpAddress?.ToString()
        ?? "unknown";

    options.AddPolicy("livekit-token", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(LiveKitPartitionKey(httpContext), _ =>
            new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            }));

    // Active-share discovery fires on connect and on every channel switch, so
    // this must be generous per client. A global limiter here caused 429s that
    // silently broke the "who is sharing" icon for everyone once the shared
    // budget was exhausted.
    options.AddPolicy("livekit-active-share", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(LiveKitPartitionKey(httpContext), _ =>
            new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            }));

    options.AddFixedWindowLimiter("channel-request-create", limiterOptions =>
    {
        limiterOptions.PermitLimit = 5;
        limiterOptions.Window = TimeSpan.FromMinutes(10);
        limiterOptions.QueueLimit = 0;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });

    options.AddPolicy("custom-companion-upload", httpContext =>
    {
        var companionOptions = httpContext.RequestServices
            .GetRequiredService<Microsoft.Extensions.Options.IOptions<CustomCompanionOptions>>().Value;
        var partitionKey = httpContext.Connection.ClientCertificate?.Thumbprint ?? "missing-client-certificate";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ =>
            new FixedWindowRateLimiterOptions
            {
                PermitLimit = companionOptions.UploadPermitLimit,
                Window = TimeSpan.FromMinutes(companionOptions.UploadWindowMinutes),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            });
    });
});

var app = builder.Build();

var matrixTokenStore = app.Services.GetRequiredService<MatrixTokenStore>();
var timeProvider = app.Services.GetRequiredService<TimeProvider>();
await matrixTokenStore.ProtectLegacyTokensAsync(timeProvider.GetUtcNow().ToUnixTimeMilliseconds());

app.UseWebSockets();
app.UseMiddleware<ConnectionLoggingMiddleware>();
app.UseRateLimiter();

app.MapGet("/health", (IServerVersionProvider version) =>
    Results.Ok(new { status = "healthy", version = version.Version }));
app.MapAuthEndpoints();
app.MapAdminEndpoints();
app.MapDmEndpoints();
app.MapAclAdminEndpoints();
app.MapChannelRequestEndpoints();
app.MapGameEndpoints();
app.MapPaintEndpoints();
app.MapChannelChatAccessEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
app.MapServerInfoEndpoints();
app.MapLiveKitEndpoints();
app.MapCustomCompanionEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
