using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddMumble();
builder.Services.AddAuth();
builder.Services.AddMatrix();
builder.Services.AddLiveKit();
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapAuthEndpoints();
app.MapLiveKitEndpoints();
app.MapReverseProxy();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
