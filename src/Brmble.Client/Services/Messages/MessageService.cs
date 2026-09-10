using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;

namespace Brmble.Client.Services.Messages;

internal sealed class MessageService : IService
{
    private readonly Func<X509Certificate2?> _getCertificate;
    private readonly Func<string?> _getApiUrl;
    private readonly Func<
        X509Certificate2,
        Uri,
        string,
        Task<ChannelRequestBridgeHandler.TlsCallResult>> _postJsonAsync;
    private NativeBridge? _bridge;

    public MessageService(
        NativeBridge? bridge,
        Func<X509Certificate2?> getCertificate,
        Func<string?> getApiUrl,
        Func<
            X509Certificate2,
            Uri,
            string,
            Task<ChannelRequestBridgeHandler.TlsCallResult>> postJsonAsync)
    {
        _bridge = bridge;
        _getCertificate = getCertificate;
        _getApiUrl = getApiUrl;
        _postJsonAsync = postJsonAsync;
    }

    public string ServiceName => "messages";

    public void Initialize(NativeBridge bridge) => _bridge = bridge;

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("messages.delete", DeleteAsync);
    }

    private async Task DeleteAsync(JsonElement data)
    {
        var requestId =
            data.TryGetProperty("requestId", out var requestIdElement)
            && requestIdElement.TryGetInt32(out var parsedRequestId)
                ? parsedRequestId
                : (int?)null;

        try
        {
            var roomId = data.TryGetProperty(
                "roomId", out var roomElement)
                ? roomElement.GetString()
                : null;
            var eventId = data.TryGetProperty(
                "eventId", out var eventElement)
                ? eventElement.GetString()
                : null;
            var apiUrl = _getApiUrl();

            if (string.IsNullOrWhiteSpace(apiUrl)
                || string.IsNullOrWhiteSpace(roomId)
                || string.IsNullOrWhiteSpace(eventId))
            {
                SendResponse(
                    requestId,
                    success: false,
                    body: null,
                    statusCode: 0,
                    error: "Not connected or invalid message deletion request.");
                return;
            }

            using var cert = _getCertificate();
            if (cert is null)
            {
                SendResponse(
                    requestId,
                    success: false,
                    body: null,
                    statusCode: 0,
                    error: "No client certificate.");
                return;
            }

            var body = JsonSerializer.Serialize(new { roomId, eventId });
            var result = await _postJsonAsync(
                cert,
                new Uri(new Uri(apiUrl, UriKind.Absolute), "messages/delete"),
                body);

            SendResponse(
                requestId,
                result.Success,
                result.Body,
                result.StatusCode,
                result.Error);
        }
        catch (Exception ex)
        {
            SendResponse(
                requestId,
                success: false,
                body: null,
                statusCode: 0,
                error: ex.Message);
        }
    }

    private void SendResponse(
        int? requestId,
        bool success,
        string? body,
        int statusCode,
        string? error)
    {
        _bridge?.Send("messages.response", new
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
