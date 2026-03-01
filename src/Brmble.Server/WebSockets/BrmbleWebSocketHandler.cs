using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.WebSockets;

public static class BrmbleWebSocketHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var cert = context.Connection.ClientCertificate;
        if (cert is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var userRepo = context.RequestServices.GetRequiredService<UserRepository>();
        var hash = CertificateHasher.HashDer(cert.RawData);
        var user = await userRepo.GetByCertHash(hash);
        if (user is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var sessionMapping = context.RequestServices.GetRequiredService<ISessionMappingService>();
        var eventBus = context.RequestServices.GetRequiredService<IBrmbleEventBus>();

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        eventBus.AddClient(ws);

        try
        {
            // Send initial snapshot
            var snapshot = sessionMapping.GetSnapshot()
                .ToDictionary(
                    kvp => kvp.Key.ToString(),
                    kvp => new { matrixUserId = kvp.Value.MatrixUserId, mumbleName = kvp.Value.MumbleName });
            var snapshotJson = JsonSerializer.Serialize(new { type = "sessionMappingSnapshot", mappings = snapshot }, JsonOptions);
            var snapshotBytes = Encoding.UTF8.GetBytes(snapshotJson);
            await ws.SendAsync(snapshotBytes, WebSocketMessageType.Text, true, context.RequestAborted);

            // Read loop until close
            var buffer = new byte[1024];
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                }
            }
        }
        catch (WebSocketException) { /* client disconnected */ }
        catch (OperationCanceledException) { /* server shutting down */ }
        finally
        {
            eventBus.RemoveClient(ws);
        }
    }
}
