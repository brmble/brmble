using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

internal sealed class WebViewBridge
{
    private readonly CoreWebView2 _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();

    public event Action<string>? OnMessage;

    public WebViewBridge(CoreWebView2 webView)
    {
        _webView = webView;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    public void Send(string type, object? data = null)
    {
        var message = new { type, data };
        var json = JsonSerializer.Serialize(message);
        Debug.WriteLine($"[WebViewBridge] Sending: {type}");
        _webView.PostWebMessageAsJson(json);
    }

    public void SendString(string message)
    {
        _webView.PostWebMessageAsString(message);
    }

    public void RegisterHandler(string type, Func<JsonElement, Task> handler)
    {
        if (!_handlers.TryGetValue(type, out var handlers))
        {
            handlers = new List<Func<JsonElement, Task>>();
            _handlers[type] = handlers;
        }
        handlers.Add(handler);
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.WebMessageAsJson;
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("type", out var typeProp))
            {
                var type = typeProp.GetString();
                var data = root.TryGetProperty("data", out var dataProp) ? dataProp : default(JsonElement?);

                Debug.WriteLine($"[WebViewBridge] Received: {type}");

                if (type != null && _handlers.TryGetValue(type, out var handlers))
                {
                    foreach (var handler in handlers)
                    {
                        _ = handler(data ?? default);
                    }
                }

                OnMessage?.Invoke(type ?? "");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WebViewBridge] Error: {ex.Message}");
        }
    }
}
