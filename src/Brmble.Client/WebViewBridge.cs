using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

internal sealed class WebViewBridge
{
    private const int WM_USER = 0x0400;
    
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private readonly CoreWebView2 _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();
    private IntPtr _hwnd;
    private string? _pendingJson;

    public event Action<string>? OnMessage;

    public WebViewBridge(CoreWebView2 webView, IntPtr hwnd)
    {
        _webView = webView;
        _hwnd = hwnd;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    public void Send(string type, object? data = null)
    {
        var message = new { type, data };
        var json = JsonSerializer.Serialize(message);
        Debug.WriteLine($"[WebViewBridge] Sending: {type}");
        
        // WebView2 must be called from UI thread - marshal via PostMessage
        _pendingJson = json;
        PostMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
    }

    public void SendString(string message)
    {
        _pendingJson = message;
        PostMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
    }

    public void ProcessUiMessage()
    {
        if (_pendingJson != null)
        {
            _webView.PostWebMessageAsJson(_pendingJson);
            _pendingJson = null;
        }
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
