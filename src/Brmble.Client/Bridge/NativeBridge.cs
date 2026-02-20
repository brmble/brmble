using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client.Bridge;

/// <summary>
/// Provides bidirectional communication between C# backend services and JavaScript frontend.
/// </summary>
/// <remarks>
/// This class wraps WebView2's messaging API and ensures all calls are marshaled to the UI thread
/// to prevent freezes. Messages are sent and received in a JSON format with a type identifier.
/// </remarks>
public sealed class NativeBridge
{
    /// <summary>
    /// Windows message constant for user-defined messages.
    /// </summary>
    private const int WM_USER = 0x0400;
    
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly CoreWebView2 _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();
    private IntPtr _hwnd;
    private readonly ConcurrentQueue<string> _pendingMessages = new();

    /// <summary>
    /// Occurs when a message is received from the frontend.
    /// </summary>
    public event Action<string>? OnMessage;

    /// <summary>
    /// Initializes a new instance of the NativeBridge class.
    /// </summary>
    /// <param name="webView">The WebView2 instance for message communication.</param>
    /// <param name="hwnd">The window handle for UI thread marshaling.</param>
    public NativeBridge(CoreWebView2 webView, IntPtr hwnd)
    {
        _webView = webView;
        _hwnd = hwnd;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    /// <summary>
    /// Sends a JSON message to the frontend.
    /// </summary>
    /// <param name="type">The message type identifier.</param>
    /// <param name="data">The optional data payload to serialize as JSON.</param>
    /// <remarks>
    /// The message is marshaled to the UI thread before sending to prevent WebView2 freezes.
    /// </remarks>
    public void Send(string type, object? data = null)
    {
        var message = new { type, data };
        var json = JsonSerializer.Serialize(message, _jsonOptions);
        Debug.WriteLine($"[NativeBridge] Sending: {type}");

        _pendingMessages.Enqueue(json);
        // No PostMessage here — caller is responsible for triggering flush
    }

    /// <summary>
    /// Sends a raw string message to the frontend.
    /// </summary>
    /// <param name="message">The message to send.</param>
    public void SendString(string message)
    {
        _pendingMessages.Enqueue(message);
    }

    /// <summary>
    /// Processes a UI thread message, delivering any pending web messages.
    /// </summary>
    /// <remarks>
    /// This should be called from the window's message handler when receiving WM_USER messages.
    /// </remarks>
    public void ProcessUiMessage()
    {
        // Drain all pending messages
        var batch = new List<string>();
        while (_pendingMessages.TryDequeue(out var json))
        {
            batch.Add(json);
        }

        if (batch.Count == 0)
            return;

        if (batch.Count == 1)
        {
            // Single message — send as-is, no array wrapper
            _webView.PostWebMessageAsJson(batch[0]);
        }
        else
        {
            // Multiple messages — wrap in JSON array, one IPC call
            _webView.PostWebMessageAsJson("[" + string.Join(",", batch) + "]");
        }
    }

    /// <summary>
    /// Immediately drains the message queue and sends to WebView2.
    /// Call this from the UI thread when you need messages delivered without
    /// waiting for a WM_USER roundtrip (e.g. after ToggleMute, Disconnect).
    /// </summary>
    public void Flush()
    {
        ProcessUiMessage();
    }

    /// <summary>
    /// Posts a WM_USER message to trigger ProcessUiMessage on the UI thread.
    /// Safe to call from any thread.
    /// </summary>
    public void NotifyUiThread()
    {
        PostMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
    }

    /// <summary>
    /// Registers a handler for messages of the specified type.
    /// </summary>
    /// <param name="type">The message type to handle.</param>
    /// <param name="handler">The async handler to invoke when messages of this type are received.</param>
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

                Debug.WriteLine($"[NativeBridge] Received: {type}");

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
            Debug.WriteLine($"[NativeBridge] Error: {ex.Message}");
        }
    }
}
