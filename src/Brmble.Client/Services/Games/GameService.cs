using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Certificate;
using Brmble.Client.Services.Voice;

namespace Brmble.Client.Services.Games;

/// <summary>
/// Bridges minigame intents from the frontend to the Brmble API over mTLS and
/// surfaces failures back to the UI. Server-originated <c>game.*</c> events are
/// forwarded separately by the voice layer's WebSocket pump
/// (<see cref="MumbleAdapter.HandleWebSocketMessage"/>), so this service only
/// handles the client → server direction.
/// </summary>
/// <remarks>
/// Mirrors <see cref="ChannelRequestBridgeHandler"/>: it reuses the same
/// certificate-backed BouncyCastle TLS POST helper and the same API-URL resolver
/// the voice layer discovered, so no second HTTP stack or cert store is needed.
/// </remarks>
internal sealed class GameService : IService
{
    private readonly CertificateService? _certService;
    private readonly Func<string?> _getApiUrl;
    private readonly Func<X509Certificate2, Uri, string, Task<ChannelRequestBridgeHandler.TlsCallResult>> _postJsonAsync;
    private NativeBridge? _bridge;

    public GameService(
        NativeBridge? bridge,
        CertificateService? certService,
        Func<string?> getApiUrl,
        Func<X509Certificate2, Uri, string, Task<ChannelRequestBridgeHandler.TlsCallResult>> postJsonAsync)
    {
        _bridge = bridge;
        _certService = certService;
        _getApiUrl = getApiUrl;
        _postJsonAsync = postJsonAsync;
    }

    public string ServiceName => "games";

    public void Initialize(NativeBridge bridge) => _bridge = bridge;

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("game.invite", d => PostAsync("games/invite", d));
        bridge.RegisterHandler("game.respond", d => PostAsync("games/respond", d));
        bridge.RegisterHandler("game.action", d => PostAsync("games/action", d));
        bridge.RegisterHandler("game.forfeit", d => PostAsync("games/forfeit", d));
    }

    /// <summary>
    /// Serializes the incoming bridge payload verbatim and POSTs it over mTLS to
    /// the matching games endpoint. On any failure, emits a <c>game.error</c>
    /// bridge event so the UI can react.
    /// </summary>
    private async Task PostAsync(string path, JsonElement data)
    {
        var apiUrl = _getApiUrl();
        if (string.IsNullOrWhiteSpace(apiUrl))
        {
            SendError(path, "Not connected — no Brmble API URL");
            return;
        }

        using var cert = _certService?.GetExportableCertificate();
        if (cert is null)
        {
            SendError(path, "No client certificate");
            return;
        }

        // Forward the frontend's payload exactly as received.
        var body = data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null
            ? "{}"
            : data.GetRawText();

        try
        {
            var baseUri = new Uri(apiUrl, UriKind.Absolute);
            var result = await _postJsonAsync(cert, new Uri(baseUri, path), body);
            if (!result.Success)
            {
                SendError(path, result.Error ?? $"Request failed (HTTP {result.StatusCode})", result.StatusCode);
            }
        }
        catch (Exception ex)
        {
            SendError(path, ex.Message);
        }
    }

    private void SendError(string path, string? error, int statusCode = 0)
    {
        _bridge?.Send("game.error", new { path, error, statusCode });
        _bridge?.NotifyUiThread();
    }
}
