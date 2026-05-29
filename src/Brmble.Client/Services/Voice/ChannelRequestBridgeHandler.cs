using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Certificate;

namespace Brmble.Client.Services.Voice;

internal sealed class ChannelRequestBridgeHandler
{
    internal readonly record struct TlsCallResult(bool Success, string? Body, int StatusCode, string? Error);

    private readonly NativeBridge? _bridge;
    private readonly CertificateService? _certService;
    private readonly Func<string?> _getApiUrl;
    private readonly Func<X509Certificate2, Uri, string, Task<TlsCallResult>> _postJsonAsync;
    private readonly Func<X509Certificate2, Uri, Task<TlsCallResult>> _getAsync;

    public ChannelRequestBridgeHandler(
        NativeBridge? bridge,
        CertificateService? certService,
        Func<string?> getApiUrl,
        Func<X509Certificate2, Uri, string, Task<TlsCallResult>> postJsonAsync,
        Func<X509Certificate2, Uri, Task<TlsCallResult>> getAsync)
    {
        _bridge = bridge;
        _certService = certService;
        _getApiUrl = getApiUrl;
        _postJsonAsync = postJsonAsync;
        _getAsync = getAsync;
    }

    public async Task HandleAsync(JsonElement data)
    {
        var requestId = data.TryGetProperty("requestId", out var requestIdProp) && requestIdProp.ValueKind == JsonValueKind.Number
            ? requestIdProp.GetInt32()
            : (int?)null;
        var action = data.TryGetProperty("action", out var actionProp) ? actionProp.GetString() : null;
        var apiUrl = _getApiUrl();

        if (string.IsNullOrWhiteSpace(action) || string.IsNullOrWhiteSpace(apiUrl))
        {
            SendResponse(requestId, false, null, 0, "Not connected or invalid channel request action");
            return;
        }

        using var cert = _certService?.GetExportableCertificate();
        if (cert is null)
        {
            SendResponse(requestId, false, null, 0, "No client certificate");
            return;
        }

        var baseUri = new Uri(apiUrl, UriKind.Absolute);
        TlsCallResult result;

        switch (action)
        {
            case "create":
            {
                var channelName = data.TryGetProperty("channelName", out var nameEl) ? nameEl.GetString() : string.Empty;
                var reason = data.TryGetProperty("reason", out var reasonEl) ? reasonEl.GetString() : string.Empty;
                var requestJson = JsonSerializer.Serialize(new { channelName, reason });
                result = await _postJsonAsync(cert, new Uri(baseUri, "channel-requests"), requestJson);
                break;
            }
            case "listMine":
            {
                result = await _getAsync(cert, new Uri(baseUri, "channel-requests/mine"));
                break;
            }
            case "listAdmin":
            {
                var status = data.TryGetProperty("status", out var statusEl) ? statusEl.GetString() : "pending";
                var path = string.IsNullOrWhiteSpace(status)
                    ? "admin/channel-requests"
                    : $"admin/channel-requests?status={Uri.EscapeDataString(status)}";
                result = await _getAsync(cert, new Uri(baseUri, path));
                break;
            }
            case "approve":
            {
                var id = data.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number
                    ? idEl.GetInt64()
                    : 0;
                result = await _postJsonAsync(cert, new Uri(baseUri, $"admin/channel-requests/{id}/approve"), "{}");
                break;
            }
            case "deny":
            {
                var id = data.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number
                    ? idEl.GetInt64()
                    : 0;
                var reason = data.TryGetProperty("reason", out var reasonEl) ? reasonEl.GetString() : string.Empty;
                var requestJson = JsonSerializer.Serialize(new { reason });
                result = await _postJsonAsync(cert, new Uri(baseUri, $"admin/channel-requests/{id}/deny"), requestJson);
                break;
            }
            default:
                SendResponse(requestId, false, null, 0, $"Unknown channel request action '{action}'");
                return;
        }

        SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
    }

    private void SendResponse(int? requestId, bool success, string? body, int statusCode, string? error)
    {
        _bridge?.Send("channelRequests.response", new
        {
            requestId,
            success,
            body,
            statusCode,
            error
        });
        _bridge?.NotifyUiThread();
    }
}
