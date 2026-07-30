using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

internal sealed class CustomCompanionBridgeHandler
{
    internal readonly record struct TlsCallResult(bool Success, string? Body, int StatusCode, string? Error);

    private readonly NativeBridge? _bridge;
    private readonly Func<X509Certificate2?> _getCertificate;
    private readonly Func<string?> _getApiUrl;
    private readonly Func<X509Certificate2, Uri, string, Task<TlsCallResult>> _postJsonAsync;
    private readonly Func<X509Certificate2, Uri, Task<TlsCallResult>> _deleteAsync;

    public CustomCompanionBridgeHandler(
        NativeBridge? bridge,
        Func<X509Certificate2?> getCertificate,
        Func<string?> getApiUrl,
        Func<X509Certificate2, Uri, string, Task<TlsCallResult>> postJsonAsync,
        Func<X509Certificate2, Uri, Task<TlsCallResult>> deleteAsync)
    {
        _bridge = bridge;
        _getCertificate = getCertificate;
        _getApiUrl = getApiUrl;
        _postJsonAsync = postJsonAsync;
        _deleteAsync = deleteAsync;
    }

    public async Task HandleAsync(JsonElement data)
    {
        var requestId = data.TryGetProperty("requestId", out var requestIdProp) && requestIdProp.ValueKind == JsonValueKind.Number
            ? requestIdProp.GetInt32()
            : (int?)null;
        var action = data.TryGetProperty("action", out var actionProp) ? actionProp.GetString() : null;
        var apiUrl = _getApiUrl();

        if ((action is not "create" and not "delete") || string.IsNullOrWhiteSpace(apiUrl))
        {
            SendResponse(requestId, false, null, 0, "Not connected or invalid companion action");
            return;
        }

        using var cert = _getCertificate();
        if (cert is null)
        {
            SendResponse(requestId, false, null, 0, "No client certificate");
            return;
        }

        try
        {
            var baseUri = new Uri(apiUrl, UriKind.Absolute);
            TlsCallResult result;

            if (action == "create")
            {
                var name = data.TryGetProperty("name", out var nameElement) ? nameElement.GetString() : null;
                var mediaUri = data.TryGetProperty("mediaUri", out var mediaUriElement) ? mediaUriElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(mediaUri))
                {
                    SendResponse(requestId, false, null, 0, "Missing companion name or media URI");
                    return;
                }

                var requestJson = JsonSerializer.Serialize(new { name, mediaUri });
                result = await _postJsonAsync(cert, new Uri(baseUri, "companions"), requestJson);
            }
            else
            {
                var eventId = data.TryGetProperty("eventId", out var eventIdElement) ? eventIdElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(eventId))
                {
                    SendResponse(requestId, false, null, 0, "Missing companion event ID");
                    return;
                }

                result = await _deleteAsync(cert, new Uri(baseUri, $"companions/{Uri.EscapeDataString(eventId)}"));
            }

            SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
        }
        catch (Exception ex)
        {
            SendResponse(requestId, false, null, 0, ex.Message);
        }
    }

    private void SendResponse(int? requestId, bool success, string? body, int statusCode, string? error)
    {
        _bridge?.Send("companions.response", new
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
