using Brmble.Server;
using Brmble.Server.Auth;
using Brmble.Server.DM;
using Brmble.Server.Middleware;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Brmble.Server.Messages;
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
builder.Services.AddMessageDeletion();
builder.Services.AddLiveKit();
builder.Services.AddOptions<ServerInfoSettings>()
    .BindConfiguration("ServerInfo");
builder.Services.AddSingleton<IServerVersionProvider, ServerVersionProvider>();
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
builder.Services.AddCors(options =>
{
    options.AddPolicy("BrmbleClient", policy =>
    {
        policy.WithOrigins("https://brmble.local", "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddFixedWindowLimiter("livekit-token", limiterOptions =>
    {
        limiterOptions.PermitLimit = 10;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueLimit = 0;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });

    options.AddFixedWindowLimiter("livekit-active-share", limiterOptions =>
    {
        limiterOptions.PermitLimit = 30;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueLimit = 0;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });
});

var app = builder.Build();

app.UseWebSockets();
app.UseMiddleware<ConnectionLoggingMiddleware>();
app.UseCors("BrmbleClient");
app.UseRateLimiter();

app.MapGet("/health", (IServerVersionProvider version) =>
    Results.Ok(new { status = "healthy", version = version.Version }));
app.MapAuthEndpoints();
app.MapAdminEndpoints();
app.MapDmEndpoints();
app.MapAclAdminEndpoints();
app.MapChannelChatAccessEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
app.MapServerInfoEndpoints();
app.MapLiveKitEndpoints();
app.MapMessageDeletionEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
