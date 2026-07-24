using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;

namespace Brmble.Client.Services.Paint;

/// <summary>Relays paint commands through the mTLS transport used by the voice client.</summary>
internal sealed class PaintService : IService
{
    private readonly Func<X509Certificate2?> _getCertificate;
    private readonly Func<string?> _getApiUrl;
    private readonly Func<X509Certificate2, Uri, Task<ChannelRequestBridgeHandler.TlsCallResult>> _getAsync;
    private readonly Func<X509Certificate2, Uri, string, Task<ChannelRequestBridgeHandler.TlsCallResult>> _postAsync;
    private NativeBridge? _bridge;

    public PaintService(NativeBridge? bridge, Func<X509Certificate2?> getCertificate, Func<string?> getApiUrl,
        Func<X509Certificate2, Uri, Task<ChannelRequestBridgeHandler.TlsCallResult>> getAsync,
        Func<X509Certificate2, Uri, string, Task<ChannelRequestBridgeHandler.TlsCallResult>> postAsync)
    {
        _bridge = bridge;
        _getCertificate = getCertificate;
        _getApiUrl = getApiUrl;
        _getAsync = getAsync;
        _postAsync = postAsync;
    }

    public string ServiceName => "paint";
    public void Initialize(NativeBridge bridge) => _bridge = bridge;

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("paint.create", data => PostAsync("paint/sessions", data));
        bridge.RegisterHandler("paint.attachSource", data => PostSessionAsync(data, "source"));
        bridge.RegisterHandler("paint.join", data => PostSessionAsync(data, "join"));
        bridge.RegisterHandler("paint.leave", data => PostSessionAsync(data, "leave"));
        bridge.RegisterHandler("paint.commitStroke", data => PostSessionAsync(data, "stroke"));
        bridge.RegisterHandler("paint.sendPreview", data => PostSessionAsync(data, "preview"));
        bridge.RegisterHandler("paint.undo", data => PostSessionAsync(data, "undo"));
        bridge.RegisterHandler("paint.clear", data => PostSessionAsync(data, "clear"));
        bridge.RegisterHandler("paint.end", data => PostSessionAsync(data, "end"));
        bridge.RegisterHandler("paint.request", HandleRequestAsync);
    }

    private Task PostSessionAsync(JsonElement data, string action)
    {
        var sessionId = data.TryGetProperty("sessionId", out var value) ? value.GetString() : null;
        return string.IsNullOrWhiteSpace(sessionId)
            ? SendErrorAsync(action, "Missing sessionId")
            : PostAsync($"paint/sessions/{Uri.EscapeDataString(sessionId)}/{action}", data);
    }

    private async Task HandleRequestAsync(JsonElement data)
    {
        var requestId = data.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt32() : (int?)null;
        var action = data.TryGetProperty("action", out var actionValue) ? actionValue.GetString() : null;
        var sessionId = data.TryGetProperty("sessionId", out var sessionValue) ? sessionValue.GetString() : null;
        if (action != "snapshot" || string.IsNullOrWhiteSpace(sessionId))
        {
            SendResponse(requestId, false, null, 0, "Invalid paint request action");
            return;
        }

        var result = await CallAsync(cert => _getAsync(cert, new Uri(new Uri(_getApiUrl()!, UriKind.Absolute), $"paint/sessions/{Uri.EscapeDataString(sessionId)}")));
        SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
    }

    private async Task PostAsync(string path, JsonElement data)
    {
        var body = data.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "{}" : data.GetRawText();
        var result = await CallAsync(cert => _postAsync(cert, new Uri(new Uri(_getApiUrl()!, UriKind.Absolute), path), body));
        if (!result.Success) await SendErrorAsync(path, result.Error ?? $"Request failed (HTTP {result.StatusCode})", result.StatusCode);
    }

    private async Task<ChannelRequestBridgeHandler.TlsCallResult> CallAsync(Func<X509Certificate2, Task<ChannelRequestBridgeHandler.TlsCallResult>> call)
    {
        var apiUrl = _getApiUrl();
        if (string.IsNullOrWhiteSpace(apiUrl)) return new(false, null, 0, "Not connected - no Brmble API URL");
        using var certificate = _getCertificate();
        if (certificate is null) return new(false, null, 0, "No client certificate");
        try { return await call(certificate); }
        catch (Exception ex) { return new(false, null, 0, ex.Message); }
    }

    private Task SendErrorAsync(string path, string error, int statusCode = 0)
    {
        SendResponse(null, false, null, statusCode, error);
        return Task.CompletedTask;
    }

    private void SendResponse(int? requestId, bool success, string? body, int statusCode, string? error)
    {
        _bridge?.Send("paint.response", new { requestId, success, body, statusCode, error });
        _bridge?.NotifyUiThread();
    }
}
