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
});

var app = builder.Build();

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
app.MapChannelChatAccessEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
app.MapServerInfoEndpoints();
app.MapLiveKitEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
