using Brmble.Server.Auth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Brmble.Server.ServerInfo;

var builder = WebApplication.CreateBuilder(args);

// Accept client TLS certificates (e.g. Mumble self-signed certs) without requiring
// a trusted CA chain. Application code enforces the presence of the certificate.
builder.WebHost.ConfigureKestrel(options =>
{
    options.ConfigureHttpsDefaults(https =>
    {
        https.ClientCertificateMode = ClientCertificateMode.AllowCertificate;
        https.ClientCertificateValidation = (_, _, _) => true;
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

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapAuthEndpoints();
app.MapServerInfoEndpoints();
app.MapLiveKitEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
