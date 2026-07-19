using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.WebSockets;

public static class BrmbleWebSocketHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static TimeSpan DeactivationGracePeriod = TimeSpan.FromSeconds(10);

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
        var activeSessions = context.RequestServices.GetRequiredService<IActiveBrmbleSessions>();

        // Keepalive so a dead peer (crash, network drop) tears the socket down promptly
        // instead of leaving the cert marked Brmble-active until TCP gives up.
        using var ws = await context.WebSockets.AcceptWebSocketAsync(new WebSocketAcceptContext
        {
            KeepAliveInterval = TimeSpan.FromSeconds(30),
            KeepAliveTimeout = TimeSpan.FromSeconds(15)
        });
        if (sessionMapping.TryGetMappingByUserId(user.Id, out var currentSessionId, out var currentMapping)
            && (currentMapping!.CertHash is null || currentMapping.CertHash == hash))
        {
            activeSessions.TrackMumbleName(currentMapping.MumbleName, hash, active: true);
            sessionMapping.TryUpdateBrmbleStatus(currentSessionId, true);
            sessionMapping.TryUpdateCertHash(currentSessionId, hash);
            await eventBus.BroadcastAsync(CreateUserMappingAddedPayload(currentSessionId, currentMapping, hash));
        }

        eventBus.AddClient(ws, user.Id);

        try
        {
            // Send initial snapshot
            var snapshot = sessionMapping.GetSnapshot()
                .ToDictionary(
                    kvp => kvp.Key.ToString(),
                    kvp => new
                    {
                        matrixUserId = kvp.Value.MatrixUserId,
                        mumbleName = kvp.Value.MumbleName,
                        companionId = kvp.Value.CompanionId,
                        certHash = kvp.Value.CertHash,
                        isBrmbleClient = kvp.Value.IsBrmbleClient
                    });
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
            if (!eventBus.HasConnectedClient(user.Id))
            {
                // Grace period: a webview reload or brief network blip reconnects within
                // seconds; deactivating immediately would flap the user to "Mumble user"
                // and back for everyone. All captured services are singletons.
                var userId = user.Id;
                _ = Task.Run(async () =>
                {
                    await Task.Delay(DeactivationGracePeriod);
                    if (!eventBus.HasConnectedClient(userId))
                        activeSessions.Deactivate(hash);
                });
            }
        }
    }

    internal static object CreateUserMappingAddedPayload(int sessionId, SessionMapping mapping, string certHash) => new
    {
        type = "userMappingAdded",
        sessionId,
        matrixUserId = mapping.MatrixUserId,
        mumbleName = mapping.MumbleName,
        companionId = mapping.CompanionId,
        certHash,
        isBrmbleClient = true
    };
}
