using Brmble.Server;
using Brmble.Server.Auth;
using Brmble.Server.Middleware;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Brmble.Server.ServerInfo;
using Brmble.Server.WebSockets;

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
builder.Services.AddOptions<ServerInfoSettings>()
    .BindConfiguration("ServerInfo");
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

app.UseWebSockets();
app.UseMiddleware<ConnectionLoggingMiddleware>();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapAuthEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
app.MapServerInfoEndpoints();
app.MapLiveKitEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
