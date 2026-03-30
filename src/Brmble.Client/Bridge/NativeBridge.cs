using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.Core;
using Brmble.Client.Services.Moderator;

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

    private readonly CoreWebView2 _webView;
    private readonly Dictionary<string, List<Func<JsonElement, Task>>> _handlers = new();
    private IntPtr _hwnd;
    private readonly ConcurrentQueue<string> _pendingMessages = new();
    private readonly ModeratorService _moderatorService;
    private int _localUserId;

    /// <summary>
    /// Occurs when a message is received from the frontend.
    /// </summary>
    public event Action<string>? OnMessage;

    /// <summary>
    /// Initializes a new instance of the NativeBridge class.
    /// </summary>
    /// <param name="webView">The WebView2 instance for message communication.</param>
    /// <param name="hwnd">The window handle for UI thread marshaling.</param>
    /// <param name="moderatorService">The moderator service for handling moderator operations.</param>
    public NativeBridge(CoreWebView2 webView, IntPtr hwnd, ModeratorService moderatorService)
    {
        _webView = webView;
        _hwnd = hwnd;
        _moderatorService = moderatorService;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    public void SetLocalUserId(int userId)
    {
        _localUserId = userId;
    }

    public void RegisterModeratorHandlers()
    {
        RegisterHandler("moderator.getRoles", async _ =>
        {
            var roles = await _moderatorService.GetRolesAsync();
            Send("moderator.roles", roles.Select(r => new {
                r.Id,
                r.Name,
                Permissions = (int)r.Permissions
            }));
        });

        RegisterHandler("moderator.createRole", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var name = data.GetProperty("name").GetString() ?? "";
            var permissions = (ModeratorPermissions)data.GetProperty("permissions").GetInt32();
            var role = await _moderatorService.CreateRoleAsync(name, permissions);
            Send("moderator.roleCreated", new { role.Id });
        });

        RegisterHandler("moderator.updateRole", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var id = data.GetProperty("id").GetString();
            string? name = null;
            ModeratorPermissions? permissions = null;
            if (data.TryGetProperty("name", out var nameEl) && nameEl.ValueKind != JsonValueKind.Null)
                name = nameEl.GetString();
            if (data.TryGetProperty("permissions", out var permEl) && permEl.ValueKind != JsonValueKind.Null)
                permissions = (ModeratorPermissions)permEl.GetInt32();
            await _moderatorService.UpdateRoleAsync(id!, name, permissions);
            Send("moderator.roleUpdated", new { id });
        });

        RegisterHandler("moderator.deleteRole", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var id = data.GetProperty("id").GetString();
            await _moderatorService.DeleteRoleAsync(id!);
            Send("moderator.roleDeleted", new { id });
        });

        RegisterHandler("moderator.getChannelModerators", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var channelId = data.GetProperty("channelId").GetUInt32();
            var moderators = await _moderatorService.GetChannelModeratorsAsync((int)channelId);
            Send("moderator.channelModerators", moderators.Select(m => new {
                m.Id,
                m.UserId,
                m.RoleId,
                m.RoleName,
                RolePermissions = (int)m.RolePermissions,
                m.AssignedAt
            }));
        });

        RegisterHandler("moderator.assign", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var channelId = data.GetProperty("channelId").GetUInt32();
            var roleId = data.GetProperty("roleId").GetString();
            var userId = data.GetProperty("userId").GetInt32();
            var assignment = await _moderatorService.AssignModeratorAsync(roleId!, (int)channelId, userId);
            Send("moderator.assigned", new { assignment.Id });
        });

        RegisterHandler("moderator.remove", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var assignmentId = data.GetProperty("assignmentId").GetString();
            var channelId = data.TryGetProperty("channelId", out var chEl) ? (int)chEl.GetUInt32() : 0;
            await _moderatorService.RemoveModeratorAsync(assignmentId!, channelId);
            Send("moderator.removed", new { assignmentId });
        });

        RegisterHandler("moderator.getCurrentUserPermissions", async data =>
        {
            if (data.ValueKind == JsonValueKind.Undefined || data.ValueKind == JsonValueKind.Null) return;
            var channelId = data.GetProperty("channelId").GetUInt32();
            var permissions = await _moderatorService.GetUserPermissionsForChannelAsync(_localUserId, (int)channelId);
            Send("moderator.currentUserPermissions", new {
                channelId,
                permissions = (int)permissions
            });
        });
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
            LogBridge($"[NativeBridge] RAW message received, length={json?.Length}");
            // Clone the data so it survives JsonDocument disposal for async handlers
            JsonElement? clonedData = null;
            string? type = null;

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
