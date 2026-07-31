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
    private readonly Func<X509Certificate2, Uri, Task<ChannelRequestBridgeHandler.TlsCallResult>> _getAsync;
    private readonly Func<X509Certificate2?> _getCertificate;
    private NativeBridge? _bridge;

    public GameService(
        NativeBridge? bridge,
        CertificateService? certService,
        Func<string?> getApiUrl,
        Func<X509Certificate2, Uri, string, Task<ChannelRequestBridgeHandler.TlsCallResult>> postJsonAsync,
        Func<X509Certificate2, Uri, Task<ChannelRequestBridgeHandler.TlsCallResult>> getAsync,
        Func<X509Certificate2?>? getCertificate = null)
    {
        _bridge = bridge;
        _certService = certService;
        _getApiUrl = getApiUrl;
        _postJsonAsync = postJsonAsync;
        _getAsync = getAsync;
        _getCertificate = getCertificate ?? (() => _certService?.GetExportableCertificate());
    }

    public string ServiceName => "games";

    public void Initialize(NativeBridge bridge) => _bridge = bridge;

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("game.invite", d => PostAsync("game.invite", "games/invite", d));
        bridge.RegisterHandler("game.respond", d => PostAsync("game.respond", "games/respond", d));
        bridge.RegisterHandler("game.cancelOffer", d => PostAsync("game.cancelOffer", "games/offers/cancel", d));
        bridge.RegisterHandler("game.ready", d => PostAsync("game.ready", "games/ready", d));
        bridge.RegisterHandler("game.rematch", d => PostAsync("game.rematch", "games/rematch", d));
        bridge.RegisterHandler("game.action", d => PostAsync("game.action", "games/action", d));
        bridge.RegisterHandler("game.forfeit", d => PostAsync("game.forfeit", "games/forfeit", d));
        bridge.RegisterHandler("games.request", HandleRequestAsync);
    }

    /// <summary>
    /// GET-with-response correlation handler, mirroring
    /// <see cref="ChannelRequestBridgeHandler"/>'s <c>channelRequests.request</c> →
    /// <c>channelRequests.response</c> pattern. The packaged WebView2 frontend can't
    /// <c>fetch()</c> these endpoints directly because they require the mTLS client
    /// certificate, so reads are tunnelled through the bridge with a <c>requestId</c>.
    /// </summary>
    private async Task HandleRequestAsync(JsonElement data)
    {
        var requestId = data.TryGetProperty("requestId", out var requestIdProp)
            && requestIdProp.ValueKind == JsonValueKind.Number
            && requestIdProp.TryGetInt32(out var parsedRequestId)
            ? parsedRequestId
            : (int?)null;

        try
        {
            var action = data.TryGetProperty("action", out var actionProp) ? actionProp.GetString() : null;
            var apiUrl = _getApiUrl();
            if (string.IsNullOrWhiteSpace(action) || string.IsNullOrWhiteSpace(apiUrl))
            {
                SendResponse(requestId, false, null, 0, "Not connected or invalid games request action");
                return;
            }

            using var cert = _getCertificate();
            if (cert is null)
            {
                SendResponse(requestId, false, null, 0, "No client certificate");
                return;
            }

            var baseUri = new Uri(apiUrl, UriKind.Absolute);
            switch (action)
            {
                case "queue":
                {
                    var result = await _getAsync(cert, new Uri(baseUri, "games/queue"));
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                case "stats":
                {
                    var gameType = data.TryGetProperty("gameType", out var gtEl) ? gtEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(gameType))
                    {
                        SendResponse(requestId, false, null, 0, "Missing gameType for stats request");
                        return;
                    }

                    var window = data.TryGetProperty("window", out var winEl) ? winEl.GetString() : null;
                    var path = $"games/stats/{Uri.EscapeDataString(gameType)}";
                    if (!string.IsNullOrWhiteSpace(window))
                        path += $"?window={Uri.EscapeDataString(window)}";

                    var result = await _getAsync(cert, new Uri(baseUri, path));
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                case "settings-get":
                {
                    var result = await _getAsync(cert, new Uri(baseUri, "games/settings"));
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                case "settings-set":
                {
                    var challengesBlocked = data.TryGetProperty("challengesBlocked", out var cbEl)
                        && (cbEl.ValueKind == JsonValueKind.True || cbEl.ValueKind == JsonValueKind.False)
                        && cbEl.GetBoolean();
                    var body = JsonSerializer.Serialize(new { challengesBlocked });
                    var result = await _postJsonAsync(cert, new Uri(baseUri, "games/settings"), body);
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                case "head-to-head":
                {
                    var opponentSession = data.TryGetProperty("opponentSession", out var oppEl)
                        && oppEl.ValueKind == JsonValueKind.Number
                        ? oppEl.GetInt64()
                        : (long?)null;
                    if (opponentSession is null)
                    {
                        SendResponse(requestId, false, null, 0, "Missing opponentSession for head-to-head request");
                        return;
                    }
                    var result = await _getAsync(cert, new Uri(baseUri, $"games/head-to-head/{opponentSession}"));
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                default:
                    SendResponse(requestId, false, null, 0, $"Unknown games request action '{action}'");
                    break;
            }
        }
        catch (Exception ex)
        {
            // Any failure here — network error, malformed URI — must still resolve the
            // frontend promise, otherwise its games.response listener leaks and the
            // stats/settings UI hangs on "Loading…".
            SendResponse(requestId, false, null, 0, ex.Message);
        }
    }

    private void SendResponse(int? requestId, bool success, string? body, int statusCode, string? error)
    {
        _bridge?.Send("games.response", new { requestId, success, body, statusCode, error });
        _bridge?.NotifyUiThread();
    }

    /// <summary>
    /// Serializes the incoming bridge payload verbatim and POSTs it over mTLS to
    /// the matching games endpoint. On any failure, emits a <c>game.error</c>
    /// bridge event so the UI can react.
    /// </summary>
    private async Task PostAsync(string command, string path, JsonElement data)
    {
        try
        {
            var apiUrl = _getApiUrl();
            if (string.IsNullOrWhiteSpace(apiUrl))
            {
                SendError(command, path, data, "Not connected — no Brmble API URL");
                return;
            }

            using var cert = _getCertificate();
            if (cert is null)
            {
                SendError(command, path, data, "No client certificate");
                return;
            }

            var body = data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null
                ? "{}"
                : data.GetRawText();
            var baseUri = new Uri(apiUrl, UriKind.Absolute);
            var result = await _postJsonAsync(cert, new Uri(baseUri, path), body);
            if (!result.Success)
            {
                // The server encodes a stable machine-readable "reason" code in the
                // error body (e.g. {"error":"…","reason":"blocked"}). Surface it so the
                // UI can branch on a code instead of pattern-matching the message text.
                var (message, reason) = ParseErrorBody(result.Body, result.Error, result.StatusCode);
                SendError(command, path, data, message, result.StatusCode, reason);
            }
        }
        catch (Exception ex)
        {
            SendError(command, path, data, ex.Message);
        }
    }

    // Extracts a human-readable message and optional structured reason code from a
    // (possibly JSON) error body. Falls back to the raw text if it isn't JSON.
    private static (string message, string? reason) ParseErrorBody(
        string? responseBody, string? transportError, int statusCode)
    {
        var fallback = transportError ?? responseBody ?? $"Request failed (HTTP {statusCode})";
        if (string.IsNullOrWhiteSpace(responseBody)) return (fallback, null);
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return (fallback, null);
            var message = doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String
                ? e.GetString() ?? fallback
                : fallback;
            var reason = doc.RootElement.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String
                ? r.GetString()
                : null;
            return (message, reason);
        }
        catch (JsonException)
        {
            return (fallback, null);
        }
    }

    private void SendError(string command, string path, JsonElement data, string? error, int statusCode = 0, string? reason = null)
    {
        long? Id(string name) => data.ValueKind == JsonValueKind.Object
            && data.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt64(out var id) ? id : null;
        _bridge?.Send("game.error", new
        {
            command,
            path,
            error,
            statusCode,
            reason,
            reservationId = Id("reservationId"),
            offerId = Id("offerId"),
            sourceMatchId = Id("sourceMatchId"),
        });
        _bridge?.NotifyUiThread();
    }
}
