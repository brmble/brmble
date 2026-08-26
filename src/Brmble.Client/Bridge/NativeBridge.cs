using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
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
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly CoreWebView2? _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();
    private IntPtr _hwnd;
    private readonly ConcurrentQueue<string> _pendingMessages = new();
    private Func<IntPtr, uint, IntPtr, IntPtr, bool> _postMessage = PostMessage;
    private int _notifyPending;
    private int _postFailureReported;

    // Test seam: runs once per drain iteration so tests can act from inside the drain
    // window and pin the release-before-drain ordering in ProcessUiMessage. Always null
    // in production — the cost is one null check per message.
    private Action? _onDrainStep;

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
        webView.WebMessageReceived += OnWebMessageReceived;
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
        // Released before the drain, not after. Releasing afterwards leaves a window
        // where a Send enqueues a payload, sees the claim still held, skips its post,
        // and leaves that payload queued with nothing scheduled to flush it. Releasing
        // first means anything enqueued after the drain triggers a fresh post, and
        // anything enqueued during the drain is drained anyway — at worst costing one
        // redundant WM_USER that finds an empty queue.
        // Pinned by ProcessUiMessage_NotifyDuringDrain_PostsAgain.
        Interlocked.Exchange(ref _notifyPending, 0);

        // Drain all pending messages
        var batch = new List<string>();
        while (_pendingMessages.TryDequeue(out var json))
        {
            batch.Add(json);
            _onDrainStep?.Invoke();
        }

        if (batch.Count == 0)
            return;

        if (_webView is null)
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
    /// <remarks>
    /// Coalescing: the claim below collapses a burst of events down to a single
    /// outstanding WM_USER instead of one per event. Without it every forwarded
    /// event posted its own message, and a stalled UI thread could push past the
    /// 10,000 per-thread posted-message cap, past which PostMessage fails and the
    /// flush trigger is lost entirely. ProcessUiMessage always drains the whole
    /// queue, so one pending post is sufficient to deliver any number of payloads.
    /// This bounds the queue to a small number of outstanding posts rather than
    /// strictly one: Flush() also runs ProcessUiMessage and so releases the claim,
    /// meaning a Flush racing a genuinely queued WM_USER lets the next notify post
    /// a second message on top of the pending one. That is harmless — a surplus
    /// WM_USER just finds an empty queue — and it stays far below the cap.
    /// </remarks>
    public void NotifyUiThread()
    {
        // A post is already outstanding; it will drain whatever we just enqueued.
        if (Interlocked.CompareExchange(ref _notifyPending, 1, 0) != 0)
            return;

        if (_postMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero))
        {
            Interlocked.Exchange(ref _postFailureReported, 0);
            return;
        }

        // The post failed, so nothing will drain the queue. Release the claim so the
        // next event reposts — this is the only retry, and it is enough because
        // NotifyUiThread is called on essentially every forwarded event.
        Interlocked.Exchange(ref _notifyPending, 0);

        // Reported once per failure episode. A wedged message queue fails for every
        // subsequent event too, and one line per event would bury the log.
        if (Interlocked.Exchange(ref _postFailureReported, 1) == 0)
        {
            Console.WriteLine(
                $"[NativeBridge] PostMessage(WM_USER) failed, win32={Marshal.GetLastWin32Error()}; " +
                "UI flush deferred to the next event.");
        }
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
            LogBridge($"[NativeBridge] RAW message received, length={json?.Length}");
            // Clone the data so it survives JsonDocument disposal for async handlers
            JsonElement? clonedData = null;
            string? type = null;

            if (json is null) return;
            using (var doc = JsonDocument.Parse(json))
            {
                var root = doc.RootElement;

                if (root.TryGetProperty("type", out var typeProp))
                {
                    type = typeProp.GetString();
                    if (root.TryGetProperty("data", out var dataProp))
                    {
                        clonedData = dataProp.Clone();
                    }
                }
            }

            if (type == null)
            {
                LogBridge($"[NativeBridge] Message had no 'type' property, skipping");
                return;
            }

            LogBridge($"[NativeBridge] Received type='{type}', hasHandler={_handlers.ContainsKey(type)}, registeredTypes=[{string.Join(",", _handlers.Keys)}]");

            if (_handlers.TryGetValue(type, out var handlers))
            {
                LogBridge($"[NativeBridge] Dispatching '{type}' to {handlers.Count} handler(s)");
                var dataForHandler = clonedData ?? default(JsonElement);
                foreach (var handler in handlers)
                {
                    _ = InvokeHandlerAsync(type, handler, dataForHandler);
                }
            }

            OnMessage?.Invoke(type);

            // Handlers may have enqueued response messages via Send().
            // Since OnWebMessageReceived runs on the UI thread, flush now
            // so replies are delivered without waiting for a WM_USER roundtrip.
            Flush();
        }
        catch (Exception ex)
        {
            LogBridge($"[NativeBridge] Error: {ex}");
        }
    }

    /// <summary>
    /// Invokes an async handler with proper error logging so exceptions are not silently swallowed.
    /// </summary>
    private static async Task InvokeHandlerAsync(string type, Func<JsonElement, Task> handler, JsonElement data)
    {
        try
        {
            LogBridge($"[NativeBridge] InvokeHandlerAsync START for '{type}'");
            await handler(data);
            LogBridge($"[NativeBridge] InvokeHandlerAsync DONE for '{type}'");
        }
        catch (Exception ex)
        {
            LogBridge($"[NativeBridge] Handler error for '{type}': {ex}");
        }
    }

#if DEBUG
    private static readonly object _logLock = new();
#endif
    // Conditional: call sites (including argument interpolation) are compiled out
    // whenever the caller is built without the DEBUG symbol defined — no per-message
    // string allocation or disk I/O in production by default (#400).
    [Conditional("DEBUG")]
    private static void LogBridge(string message)
    {
        try
        {
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] {message}";
            Debug.WriteLine(line);
#if DEBUG
            lock (_logLock)
            {
                File.AppendAllText(
                    Path.Combine(AppContext.BaseDirectory, "bridge.log"),
                    line + Environment.NewLine);
            }
#endif
        }
        catch { /* best-effort logging */ }
    }
}
