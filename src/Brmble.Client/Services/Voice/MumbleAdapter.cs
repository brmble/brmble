using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using Org.BouncyCastle.Tls;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;
using Brmble.Audio;
using Brmble.Audio.Processing;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Certificate;
using Brmble.Client.Services.Idle;
using Brmble.Client.Services.Voice.Input;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Mumble protocol adapter — translates between MumbleSharp events and
/// the voice.* bridge messages consumed by the frontend.
/// </summary>
internal sealed class MumbleAdapter : BasicMumbleProtocol, VoiceService
{
    private readonly NativeBridge? _bridge;
    private readonly IntPtr _hwnd;
    private CancellationTokenSource? _cts;
    private Thread? _processThread;
    private AudioManager? _audioManager;
    private InputRouter? _inputRouter;
    // Tracked so we can unsubscribe when AudioManager is disposed.
    private Action<bool>? _pttStateChangedHandler;
    private string? _lastWelcomeText;
    private readonly CertificateService? _certService;
    private uint? _previousChannelId;
    private uint? _pendingLocalJoinChannelId;
    private bool _leftVoice;
    private bool _leaveVoiceInProgress;
    private bool _canRejoin;
    private TransmissionMode _previousMode = TransmissionMode.Continuous;
    private volatile bool _intentionalDisconnect = false;
    private volatile bool _rejected = false;
    private volatile bool _isReconnect = false;
    private volatile bool _serverRemovalDisconnect = false;
    private volatile CancellationTokenSource? _reconnectCts;
    private string? _reconnectHost;
    private int _reconnectPort;
    private volatile string? _reconnectUsername;
    private string? _reconnectPassword;
    private string? _currentPttKey;
    private readonly Stopwatch _notifyThrottle = Stopwatch.StartNew();
    private string? _apiUrl;
    private string? _activeServerId;
    private Dictionary<string, string> _userMappings = new();
    private readonly ConcurrentDictionary<uint, SessionMappingEntry> _sessionMappings = new();
    private CancellationTokenSource? _wsCts;
    private long _wsGeneration;
    private readonly IAppConfigService? _appConfigService;
    private readonly VoiceIdleTracker? _voiceIdleTracker;
    private System.Threading.Timer? _voiceIdlePollTimer;
    private int _voiceIdlePollOffset;
    private int _voiceIdlePollInProgress;   // 0 = idle, 1 = tick running (Interlocked guard)
    private int _voiceIdlePollGeneration;   // bumped on Stop so stale callbacks bail
    // 5-second tick × 4-message batch = 0.8 msg/s sustained, burst 4 — comfortably
    // under Mumble's documented leaky-bucket budget (~1 msg/s sustained, burst 5).
    // Sweep cycle for N users: ceil(N/4) × 5s. 30-user channel = ~37.5s.
    private const int VOICE_IDLE_POLL_INTERVAL_MS = 5_000;
    private const int VOICE_IDLE_POLL_BATCH_SIZE = 4;
    private long _lastLocalTransmitNotifyTicks;  // Environment.TickCount64 baseline
    private const int LOCAL_TRANSMIT_NOTIFY_THROTTLE_MS = 5_000;
    private System.Threading.Timer? _healthTimer;
    private long _healthGeneration;
    private volatile bool _serverHealthWasConnected;
    private volatile bool _credentialsAlreadyFetched;
    private volatile bool _sawServerHealthFailureSinceCredentials;
    private BanList? _cachedBanList;
    private readonly object _banListLock = new();
    private int _pendingBanQuery = 0;
    // Accept self-signed certs: Brmble servers use self-signed TLS certificates
    // (same pattern as WebSocket at line ~1290 and Mumble's BouncyCastle TLS).
    private static readonly HttpClient _healthHttpClient = new(new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
    })
    { Timeout = TimeSpan.FromSeconds(5) };

    internal record SessionMappingEntry(string MatrixUserId, string MumbleName, string CompanionId, bool IsBrmbleClient = false);

    /// <summary>
    /// Parses a JSON object whose keys are session IDs and values contain
    /// matrixUserId, mumbleName, companionId, and optionally isBrmbleClient into a dictionary.
    /// Shared by the auth-response and WebSocket snapshot parsers.
    /// </summary>
    internal static Dictionary<uint, SessionMappingEntry> ParseSessionMappings(System.Text.Json.JsonElement mappingsElement)
    {
        var result = new Dictionary<uint, SessionMappingEntry>();
        foreach (var prop in mappingsElement.EnumerateObject())
        {
            if (uint.TryParse(prop.Name, out var sid))
            {
                var matrixId = prop.Value.TryGetProperty("matrixUserId", out var m) ? m.GetString() : null;
                var name = prop.Value.TryGetProperty("mumbleName", out var n) ? n.GetString() : null;
                var companionId = prop.Value.TryGetProperty("companionId", out var c) ? c.GetString() : "floppy";
                if (matrixId is not null && name is not null && companionId is not null)
                {
                    var isBrmble = prop.Value.TryGetProperty("isBrmbleClient", out var b) && b.GetBoolean();
                    result[sid] = new SessionMappingEntry(matrixId, name, companionId, isBrmble);
                }
            }
        }
        return result;
    }

    public string ServiceName => "mumble";

    /// <summary>Optional callback invoked when a Brmble API URL is discovered from welcome text (Flow A).</summary>
    public Action<string>? OnApiUrlDiscovered { get; set; }

    /// <summary>The ID of the ServerEntry that initiated the current connection, if any.</summary>
    public string? ActiveServerId => _activeServerId;

    public MumbleAdapter(NativeBridge bridge, IntPtr hwnd, CertificateService? certService = null, IAppConfigService? appConfigService = null, VoiceIdleTracker? voiceIdleTracker = null)
    {
        _bridge = bridge;
        _hwnd = hwnd;
        _certService = certService;
        _appConfigService = appConfigService;
        _voiceIdleTracker = voiceIdleTracker;
        _audioManager = new AudioManager();
        WireAudioManagerBridgeEvents();
        // Toggle* actions now fire via MumbleAdapter.FireShortcutAction
        // (driven by InputRouter.ShortcutReleased); AudioManager no longer
        // owns input dispatch, so those events were removed.

        // InputRouter is created ONCE in the constructor and lives for the
        // app's lifetime. Its WH_MOUSE_LL hook is installed on the calling
        // (UI) thread and Win32 requires that thread to have a message pump
        // for events to be delivered. Re-creating it on Connect would put
        // the hook on whichever thread happens to call Connect (often a
        // worker thread via ReconnectLoop / bridge dispatch) and the hook
        // would silently receive no events.
        //
        // PttStateChanged is the only subscription that depends on the
        // AudioManager (which IS recreated on Disconnect/Connect); it is
        // re-wired in WireAudioManagerToInputRouter() each time AudioManager
        // is created. The bridge-pointing subscriptions wire once here.
        _inputRouter = new InputRouter(new Win32InputBackend(_hwnd));
        _inputRouter.ShortcutPressed += action => {
            _bridge?.Send("voice.shortcutPressed", new { action });
            _bridge?.NotifyUiThread();
            if (action == "toggleGame")
            {
                _bridge?.Send("game.toggle", null);
                _bridge?.NotifyUiThread();
            }
        };
        _inputRouter.ShortcutReleased += (action, forced) => {
            _bridge?.Send("voice.shortcutReleased", new { action, forced });
            _bridge?.NotifyUiThread();
            // Skip the user-facing toggle when the release is forced — i.e.
            // we're tearing down (Disconnect/channel transition/Suspend) or
            // the binding got evicted under a held button. Otherwise
            // disconnecting while a shortcut is held would toggle mute, leave
            // voice, etc. as an unintended side effect.
            if (!forced) FireShortcutAction(action);
        };
        _inputRouter.JsForceReleaseRequested += () =>
        {
            _bridge?.Send("voice.pttKey", new { pressed = false, forced = true });
            _bridge?.NotifyUiThread();
        };
        WireAudioManagerToInputRouter();
    }

    private void WireAudioManagerToInputRouter()
    {
        if (_inputRouter == null || _audioManager == null) return;
        if (_pttStateChangedHandler != null)
        {
            _inputRouter.PttStateChanged -= _pttStateChangedHandler;
        }
        _pttStateChangedHandler = _audioManager.SetPttActiveExternal;
        _inputRouter.PttStateChanged += _pttStateChangedHandler;
    }

    /// <summary>
    /// Wires the AudioManager events that emit bridge messages. Called both
    /// from the constructor and from Connect's recreate block — without this
    /// indirection, the recreate block had to remember every subscription
    /// (and previously missed <see cref="AudioManager.VadMeterUpdated"/>,
    /// silently breaking the VAD meter in the settings UI across reconnects).
    /// </summary>
    private void WireAudioManagerBridgeEvents()
    {
        if (_audioManager == null) return;
        _audioManager.OnLossReport += loss =>
        {
            _bridge?.Send("voice.loss", new { loss });
        };
        _audioManager.VadMeterUpdated += (rms, isOpen) =>
        {
            _bridge?.Send("voice.vadMeter", new { rms, isOpen });
            // Audio thread → must wake the UI thread so WebView2 actually
            // flushes the queue.
            _bridge?.NotifyUiThread();
        };
    }

    /// <summary>
    /// Dispatches a shortcut action when its key is released. Previously lived
    /// in AudioManager; moved here as part of Task 13 (InputRouter ownership).
    /// </summary>
    private void FireShortcutAction(string action)
    {
        switch (action)
        {
            case "toggleMute":
                ToggleMute();
                break;
            case "toggleMuteDeafen":
                ToggleMute();
                ToggleDeaf();
                break;
            case "continuousTransmission":
                if (_audioManager == null) return;
                var current = _audioManager.TransmissionMode;
                var newMode = current == TransmissionMode.Continuous ? _previousMode : TransmissionMode.Continuous;
                if (current != TransmissionMode.Continuous) _previousMode = current;
                var pttKey = (newMode == TransmissionMode.PushToTalk || newMode == TransmissionMode.PushToTalkPlus) ? _currentPttKey : null;
                _audioManager.SetTransmissionMode(newMode, pttKey);
                _inputRouter?.SetPttBinding(pttKey);
                break;
            case "toggleLeaveVoice":
                LeaveVoice();
                break;
            case "toggleDmScreen":
                _bridge?.Send("voice.toggleDmScreen", null);
                _bridge?.NotifyUiThread();
                break;
            case "toggleScreenShare":
                _bridge?.Send("voice.toggleScreenShare", null);
                _bridge?.NotifyUiThread();
                break;
        }
    }

    public void Initialize(NativeBridge bridge) { }

    public void Connect(string host, int port, string username, string password = "", string? apiUrl = null)
    {
        // Clear reconnect flag on every fresh Connect() call.  ReconnectLoop
        // sets it to true *after* calling Connect(); clearing here prevents
        // stale state if a previous connection dropped before ServerSync.
        _isReconnect = false;

        if (apiUrl is not null)
            _apiUrl = apiUrl;

        if (Connection?.State == ConnectionStates.Connected)
            throw new InvalidOperationException("Already connected");

        if (string.IsNullOrWhiteSpace(host))
        {
            _bridge?.Send("voice.error", new { message = "Server address is required" });
            _bridge?.Send("voice.disconnected", new { reason = "Server address is required" });
            _bridge?.NotifyUiThread();
            return;
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            _bridge?.Send("voice.error", new { message = "Username is required" });
            _bridge?.Send("voice.disconnected", new { reason = "Username is required" });
            _bridge?.NotifyUiThread();
            return;
        }

        if (port is <= 0 or > 65535)
        {
            _bridge?.Send("voice.error", new { message = "Port must be between 1 and 65535" });
            _bridge?.Send("voice.disconnected", new { reason = "Port must be between 1 and 65535" });
            _bridge?.NotifyUiThread();
            return;
        }

        _intentionalDisconnect = false;
        _rejected = false;

        // Recreate audio manager if disposed by a previous Disconnect()
        if (_audioManager == null)
        {
            _audioManager = new AudioManager();
            WireAudioManagerBridgeEvents();
        }

        // InputRouter is app-lifetime; only the AudioManager-dependent
        // subscription needs re-wiring when AudioManager was recreated.
        // Reapply settings so the fresh AudioManager gets the user's
        // transmission mode (otherwise it stays on its default Continuous
        // mode and ServerSync's mic-start path leaves the mic running).
        if (_inputRouter != null)
        {
            WireAudioManagerToInputRouter();
            var settings = _appConfigService?.GetSettings();
            if (settings != null) ApplySettings(settings);
        }

        try
        {
            SendSystemMessage($"Connecting to {host}:{port}...", "connecting");
            _bridge?.NotifyUiThread();

            var connection = new MumbleConnection(host, port, this, voiceSupport: true);
            connection.Connect(username, password, Array.Empty<string>(), "Brmble");

            _cts = new CancellationTokenSource();
            _processThread = new Thread(() => ProcessLoop(_cts.Token))
            {
                IsBackground = true,
                Name = "MumbleProcess"
            };
            _processThread.Start();
        }
        catch (System.Net.Sockets.SocketException ex)
        {
            var message = ex.SocketErrorCode switch
            {
                System.Net.Sockets.SocketError.HostNotFound => $"Server '{host}' not found",
                System.Net.Sockets.SocketError.ConnectionRefused => $"Connection refused to {host}:{port}",
                System.Net.Sockets.SocketError.TimedOut => $"Connection timed out to {host}:{port}",
                System.Net.Sockets.SocketError.NetworkUnreachable => "Network unreachable",
                System.Net.Sockets.SocketError.HostUnreachable => "Server unreachable",
                _ => $"Connection failed: {ex.Message}"
            };
            _bridge?.Send("voice.error", new { message, code = ex.SocketErrorCode.ToString() });
            Debug.WriteLine($"[Mumble] Connection failed: {message}");
            Disconnect();
        }
        catch (Exception ex)
        {
            _bridge?.Send("voice.error", new { message = ex.Message });
            Debug.WriteLine($"[Mumble] Connection failed: {ex.Message}");
            Disconnect();
        }
    }

    public void Disconnect()
    {
        _isReconnect = false;
        _cts?.Cancel();
        var processThread = _processThread;
        if (processThread != null && processThread != Thread.CurrentThread)
            processThread.Join(2000);
        _processThread = null;

        StopVoiceIdlePolling();
        _voiceIdleTracker?.Clear();

        // Force release any held PTT/shortcut state before tearing down audio,
        // so the matching release events fire while the AudioManager is still
        // alive to consume them.
        _inputRouter?.ReleaseAllHeld();

        // Unwire InputRouter → AudioManager event subscriptions before disposing
        // AudioManager. We do NOT dispose InputRouter itself — its WH_MOUSE_LL
        // hook MUST stay alive on the UI thread that installed it. Re-creating
        // it on Connect (which can run on a worker thread via ReconnectLoop or
        // bridge dispatch) would install a dead hook on a thread without a
        // message pump.
        if (_inputRouter != null && _pttStateChangedHandler != null)
        {
            _inputRouter.PttStateChanged -= _pttStateChangedHandler;
            _pttStateChangedHandler = null;
        }

        _audioManager?.Dispose();
        _audioManager = null;

        // Reset cached NS state so that the next ApplySettings on a fresh
        // AudioManager always re-applies the level.
        _lastNoiseSuppressionLevel = null;

        try
        {
            // Close TCP/UDP sockets — BasicMumbleProtocol.Close() only nulls
            // the Connection reference without closing the sockets.
            Connection?.Close();
        }
        catch { /* best effort */ }

        try
        {
            // Resets LocalUser and Connection to null, stops the encoding thread.
            // Without this the next ServerSync throws "Second ServerSync Received".
            Close();
        }
        catch { /* best effort */ }

        _wsCts?.Cancel();
        _wsCts?.Dispose();
        _wsCts = null;
        Interlocked.Increment(ref _wsGeneration);
        StopHealthCheck();
        _serverHealthWasConnected = false;
        _credentialsAlreadyFetched = false;
        _sawServerHealthFailureSinceCredentials = false;
        _sessionMappings.Clear();

        UserDictionary.Clear();
        ChannelDictionary.Clear();
        _lastWelcomeText = null;
        _previousChannelId = null;
        _pendingLocalJoinChannelId = null;
        if (_intentionalDisconnect || _reconnectHost == null)
        {
            _apiUrl = null;
            _activeServerId = null;
            _reconnectPassword = null;
        }
        _leftVoice = false;
        _leaveVoiceInProgress = false;
        EmitCanRejoin(false);

        // Only emit voice.disconnected for intentional disconnects or when no reconnect is possible.
        // When _intentionalDisconnect is false and we have reconnect params, ReconnectLoop will take over.
        if (_serverRemovalDisconnect)
        {
            _serverRemovalDisconnect = false;
        }
        else if (_intentionalDisconnect || _reconnectHost == null)
        {
            _bridge?.Send("voice.disconnected", null);
            _bridge?.NotifyUiThread();
        }
    }

    private void ProcessLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested
               && Connection is { State: not ConnectionStates.Disconnected })
        {
            try
            {
                if (Connection.Process())
                {
                    // Throttle UI notifications to at most once per 50ms (20/sec).
                    // Without this, UDP voice packets (20-50+/sec) flood the UI
                    // thread with WM_USER messages and cause choppy audio.
                    if (_notifyThrottle.ElapsedMilliseconds >= 50)
                    {
                        _bridge?.NotifyUiThread();
                        _notifyThrottle.Restart();
                    }
                    Thread.Yield();
                }
                else
                {
                    // No more packets — flush any queued messages before sleeping.
                    _bridge?.NotifyUiThread();
                    _notifyThrottle.Restart();
                    Thread.Sleep(1);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                bool isFatalConnection = ex is IOException
                    or System.Net.Sockets.SocketException
                    or InvalidOperationException
                    or ObjectDisposedException
                    or NotImplementedException
                    or global::ProtoBuf.ProtoException;

                // Suppress spurious error notifications during intentional shutdown
                // (e.g. ObjectDisposedException from teardown racing the process thread)
                // or after a server reject (the real error was already sent by Reject callback).
                if (!_intentionalDisconnect && !ct.IsCancellationRequested && !_rejected)
                {
                    _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
                    _bridge?.NotifyUiThread();
                }

                if (isFatalConnection)
                    break; // Exit loop to trigger reconnect logic below
            }
        }

        // Loop exited — either intentional (CTS cancelled) or unexpected connection drop.
        Debug.WriteLine($"[Mumble] ProcessLoop exited: _intentionalDisconnect={_intentionalDisconnect}, ct.IsCancellationRequested={ct.IsCancellationRequested}, _reconnectHost={_reconnectHost}, _reconnectCts={_reconnectCts}, _rejected={_rejected}");
        if (!_intentionalDisconnect && !ct.IsCancellationRequested && _reconnectHost != null && _reconnectCts == null)
        {
            if (_rejected)
            {
                // Server rejected the connection (ban, auth failure, etc.) — the specific
                // error was already sent by the Reject callback. Don't overwrite it with a
                // generic message, and don't auto-reconnect (it will just fail again).
                Debug.WriteLine("[Mumble] Reject path: calling Disconnect() then sending voice.disconnected");
                Disconnect();
                _bridge?.Send("voice.disconnected", new { reconnectAvailable = true });
                _bridge?.NotifyUiThread();
            }
            else
            {
                // Notify UI of the connection loss so the error is visible during reconnect.
                _bridge?.Send("voice.error", new { message = "Connection to server lost" });
                _bridge?.NotifyUiThread();

                var reconnectEnabled = _appConfigService?.GetSettings().ReconnectEnabled ?? true;
                if (reconnectEnabled)
                {
                    // Unexpected drop — clean up and start reconnect loop.
                    Disconnect();
                    Task.Run(() => ReconnectLoop());
                }
                else
                {
                    // Reconnect disabled — clean up and emit disconnected with manual reconnect option.
                    Disconnect();
                    _bridge?.Send("voice.disconnected", new { reconnectAvailable = true });
                    _bridge?.NotifyUiThread();
                }
            }
        }
        // If intentional or CTS was cancelled, Disconnect() was already called by the handler.
    }

    private async Task ReconnectLoop()
    {
        var delays = new[] { 2000, 4000, 8000, 16000, 30000 };
        int attempt = 0;
        var cts = new CancellationTokenSource();
        _reconnectCts = cts;
        var token = cts.Token;

        try
        {
            while (!token.IsCancellationRequested && !_intentionalDisconnect)
            {
                int delayMs = delays[Math.Min(attempt, delays.Length - 1)];
                _bridge?.Send("voice.reconnecting", new { attempt = attempt + 1, delayMs });
                _bridge?.NotifyUiThread();

                try
                {
                    await Task.Delay(delayMs, token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                if (_intentionalDisconnect || token.IsCancellationRequested)
                    break;

                try
                {
                    Connect(_reconnectHost!, _reconnectPort, _reconnectUsername!, _reconnectPassword ?? "");
                    _isReconnect = true;
                    return; // ServerSync will emit voice.connected
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Connect failed; continue to next attempt
                }

                attempt++;
            }

            if (!_intentionalDisconnect)
            {
                _bridge?.Send("voice.reconnectFailed", new { reason = "Reconnect cancelled or failed" });
                _bridge?.NotifyUiThread();
            }
        }
        finally
        {
            cts.Dispose();
            if (_reconnectCts == cts)
                _reconnectCts = null;
        }
    }

    public void SendMessage(string message) => SendTextMessage(message);

    /// <summary>
    /// Sends a text message to the current channel, or to a specific channel if channelId is provided.
    /// </summary>
    /// <param name="message">The message text to send.</param>
    /// <param name="channelId">Optional channel ID to target. If null, sends to the current channel.</param>
    public void SendTextMessage(string message, uint? channelId = null)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        var textMessage = new TextMessage
        {
            Message = message
        };

        if (channelId.HasValue)
        {
            textMessage.ChannelIds = new[] { channelId.Value };
        }
        else
        {
            textMessage.ChannelIds = new[] { 0u };
        }

        Connection.SendControl(PacketType.TextMessage, textMessage);
    }

    /// <summary>
    /// Sends a private text message to a specific user session.
    /// </summary>
    /// <param name="message">The message text to send.</param>
    /// <param name="targetSession">The session ID of the target user.</param>
    public void SendPrivateMessage(string message, uint targetSession)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        var textMessage = new TextMessage
        {
            Message = message,
            Sessions = new[] { targetSession },
        };

        Connection.SendControl(PacketType.TextMessage, textMessage);
    }

    /// <summary>
    /// Sends a system message to the frontend via the voice.system bridge event.
    /// </summary>
    /// <param name="message">The message text (may contain HTML for welcome messages).</param>
    /// <param name="systemType">The type: connecting, welcome, userJoined, userLeft, kicked, banned.</param>
    /// <param name="html">Whether the message contains HTML that should be rendered as-is.</param>
    private void SendSystemMessage(string message, string systemType, bool html = false)
    {
        _bridge?.Send("voice.system", new { message, systemType, html });
    }

    public void ToggleMute()
    {
        if (LocalUser == null) return;
        // Block mute toggle when in leave-voice state or when deafened
        // (same guards as the UI buttons)
        if (_leftVoice || LocalUser.SelfDeaf) return;

        LocalUser.SelfMuted = !LocalUser.SelfMuted;
        if (!LocalUser.SelfMuted && LocalUser.SelfDeaf)
            LocalUser.SelfDeaf = false;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetMuted(LocalUser.SelfMuted);

        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        _bridge?.NotifyUiThread();
    }

    /// <summary>
    /// Activates leave-voice state: mutes and deafens the local user and fires
    /// the three bridge events. Does NOT move the user to root — caller is
    /// responsible for ensuring the user is already in the correct channel.
    /// <para>
    /// <c>_previousChannelId</c> must be set (or left null) by the caller
    /// before invoking this method. When null the rejoin action is disabled.
    /// </para>
    /// </summary>
    /// <param name="channelMoveInProgress">
    /// Pass <c>true</c> when a <see cref="JoinChannel"/> call has just been issued
    /// so that the subsequent <see cref="UserState"/> channel-change echo clears the
    /// in-progress flag rather than being treated as a manual channel join.
    /// Pass <c>false</c> (the default) when no channel move is in flight (e.g. auto-
    /// activate on connect — the user is already in root).
    /// </param>
    private void ActivateLeaveVoice(bool channelMoveInProgress = false)
    {
        if (LocalUser == null) return;

        _leftVoice = true;
        _leaveVoiceInProgress = channelMoveInProgress;

        LocalUser.SelfMuted = true;
        LocalUser.SelfDeaf = true;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetMuted(true);
        _audioManager?.SetDeafened(true);

        _bridge?.Send("voice.selfMuteChanged", new { muted = true });
        _bridge?.Send("voice.selfDeafChanged", new { deafened = true });
        _bridge?.Send("voice.leftVoiceChanged", new { leftVoice = true });
        EmitCanRejoin(_previousChannelId != null);
    }

    private void ClearLeaveVoiceState()
    {
        if (LocalUser == null) return;

        _leftVoice = false;
        _previousChannelId = null;

        LocalUser.SelfMuted = false;
        LocalUser.SelfDeaf = false;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetMuted(false);
        _audioManager?.SetDeafened(false);

        _bridge?.Send("voice.selfMuteChanged", new { muted = false });
        _bridge?.Send("voice.selfDeafChanged", new { deafened = false });
        _bridge?.Send("voice.leftVoiceChanged", new { leftVoice = false });
        EmitCanRejoin(false);
    }

    /// <summary>
    /// Updates <see cref="_canRejoin"/> and emits <c>voice.canRejoinChanged</c>.
    /// Call whenever <see cref="_previousChannelId"/> is assigned or cleared.
    /// </summary>
    private void EmitCanRejoin(bool canRejoin)
    {
        _canRejoin = canRejoin;
        _bridge?.Send("voice.canRejoinChanged", new { canRejoin });
    }

    /// <summary>
    /// Toggles leave voice: first press saves the current channel, moves to root,
    /// and forces mute + deafen. Second press rejoins the saved channel and unmutes/undeafens.
    /// </summary>
    public void LeaveVoice()
    {
        if (LocalUser == null || Connection is not { State: ConnectionStates.Connected })
            return;

        if (!_leftVoice)
        {
            // Save current channel, move to root, then activate leave-voice state.
            // Pass channelMoveInProgress: true so UserState clears the flag when
            // the server echoes back the channel change.
            _previousChannelId = LocalUser.Channel?.Id ?? 0;
            JoinChannel(0);
            ActivateLeaveVoice(channelMoveInProgress: true);
            _bridge?.NotifyUiThread();
        }
        else
        {
            // No channel to rejoin — leave voice was auto-activated on connect
            if (_previousChannelId == null)
                return;

            // Rejoin previous channel
            _leftVoice = false;
            _leaveVoiceInProgress = true;
            var channelId = _previousChannelId ?? 0; // ?? 0 is unreachable: null case is guarded above
            _previousChannelId = null;
            EmitCanRejoin(false);

            JoinChannel(channelId);

            LocalUser.SelfMuted = false;
            LocalUser.SelfDeaf = false;
            LocalUser.SendMuteDeaf();
            _audioManager?.SetMuted(false);
            _audioManager?.SetDeafened(false);

            _bridge?.Send("voice.selfMuteChanged", new { muted = false });
            _bridge?.Send("voice.selfDeafChanged", new { deafened = false });
            _bridge?.Send("voice.leftVoiceChanged", new { leftVoice = false });
            _bridge?.NotifyUiThread();
        }
    }

    public void ToggleDeaf()
    {
        if (LocalUser == null) return;
        // Block deafen toggle when in leave-voice state
        // (same guard as the UI button)
        if (_leftVoice) return;

        LocalUser.SelfDeaf = !LocalUser.SelfDeaf;
        LocalUser.SelfMuted = LocalUser.SelfDeaf;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetDeafened(LocalUser.SelfDeaf);
        _audioManager?.SetMuted(LocalUser.SelfMuted);

        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        _bridge?.NotifyUiThread();
    }

    /// <summary>
    /// Parses a transmission mode string into a TransmissionMode enum.
    /// Internal for testing.
    /// </summary>
    internal static TransmissionMode ParseTransmissionMode(string mode)
    {
        return mode switch
        {
            "voiceActivity" => TransmissionMode.VoiceActivity,
            "pushToTalkPlus" => TransmissionMode.PushToTalkPlus,
            "pushToTalk"    => TransmissionMode.PushToTalk,
            "continuous"    => TransmissionMode.Continuous,
            _ => TransmissionMode.Continuous,
        };
    }

    /// <summary>
    /// Returns whether DTX (discontinuous transmission) should be enabled for the given mode.
    /// DTX is on for VAD/Continuous (silence suppression), off for PTT/PTT+.
    /// Internal for testing.
    /// </summary>
    internal static bool ShouldEnableDtx(TransmissionMode mode)
    {
        return mode != TransmissionMode.PushToTalk && mode != TransmissionMode.PushToTalkPlus;
    }

    public void SetTransmissionMode(string mode, string? key)
    {
        var parsed = ParseTransmissionMode(mode);
        if (parsed == TransmissionMode.Continuous && mode != "continuous")
            Debug.WriteLine($"[Audio] Unknown transmission mode '{mode}', defaulting to Continuous");

        bool isPtt = parsed == TransmissionMode.PushToTalk || parsed == TransmissionMode.PushToTalkPlus;

        // Only adopt a non-null key. Callers (e.g. ApplySettings on reconnect,
        // or a bridge message that omits the key field) may pass null when
        // they don't intend to clear the binding — they're just re-asserting
        // the mode. Treating null as "clear" silently unbinds PTT on every
        // settings reapply that has a stale AppConfig.PushToTalkKey value.
        if (isPtt && key != null) _currentPttKey = key;

        _audioManager?.SetDtx(ShouldEnableDtx(parsed));
        _audioManager?.SetTransmissionMode(parsed, key);

        // For PTT modes, always route the live _currentPttKey (preserving
        // any previously-bound key when the caller omitted it). For
        // non-PTT modes, null clears the binding.
        _inputRouter?.SetPttBinding(isPtt ? _currentPttKey : null);
    }

    private NoiseSuppressionLevel? _lastNoiseSuppressionLevel;

    public void ApplySettings(AppSettings settings)
    {
        SetTransmissionMode(settings.Audio.TransmissionMode, settings.Audio.PushToTalkKey);
        var vadSensitivity = settings.Audio.VadSensitivity switch
        {
            "low" => VadSensitivity.Low,
            "high" => VadSensitivity.High,
            _ => VadSensitivity.Balanced,
        };
        _audioManager?.SetVadSensitivity(vadSensitivity);

        // InputRouter is the sole owner of shortcut bindings.
        _inputRouter?.SetShortcutBinding("toggleMute", settings.Shortcuts.ToggleMuteKey);
        _inputRouter?.SetShortcutBinding("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
        _inputRouter?.SetShortcutBinding("toggleLeaveVoice", settings.Shortcuts.ToggleLeaveVoiceKey);
        _inputRouter?.SetShortcutBinding("toggleDmScreen", settings.Shortcuts.ToggleDMScreenKey);
        _inputRouter?.SetShortcutBinding("toggleScreenShare", settings.Shortcuts.ToggleScreenShareKey);
        _inputRouter?.SetShortcutBinding("toggleGame", settings.Shortcuts.ToggleGameKey);
        _audioManager?.SetInputVolume(settings.Audio.InputVolume);
        _audioManager?.SetOutputVolume(settings.Audio.OutputVolume);
        ApplyAudioDeviceSettings(settings);

        _audioManager?.SetOpusBitrate(settings.Audio.OpusBitrate);
        _audioManager?.SetOpusFrameMs(settings.Audio.OpusFrameSize);
        _audioManager?.SetCaptureApi(settings.Audio.CaptureApi);
        _audioManager?.SetVoiceHoldMs(settings.Audio.VoiceHoldMs);

        var nsLevel = settings.NoiseSuppression.Level;
        if (_lastNoiseSuppressionLevel != nsLevel)
        {
            _lastNoiseSuppressionLevel = nsLevel;
            _audioManager?.SetNoiseSuppression(nsLevel);
        }
    }

    private void ApplyAudioDeviceSettings(AppSettings settings)
    {
        if (_audioManager is null)
            return;

        var (repairedSettings, repaired) = RepairAudioDeviceSettings(
            settings,
            _audioManager.IsInputDeviceAvailable,
            _audioManager.IsOutputDeviceAvailable,
            LogToFile);
        var inputDevice = repairedSettings.Audio.InputDevice;
        var outputDevice = repairedSettings.Audio.OutputDevice;

        _audioManager.SetInputDevice(inputDevice);
        _audioManager.SetOutputDevice(outputDevice);

        if (repaired)
        {
            _appConfigService?.SetSettings(repairedSettings);
            _bridge?.Send("settings.updated", repairedSettings);
            SendSystemMessage("Saved audio device unavailable; switched to Default (System).", "audioDeviceFallback");
        }
    }

    internal static (AppSettings Settings, bool Repaired) RepairAudioDeviceSettings(
        AppSettings settings,
        Func<string?, bool> isInputDeviceAvailable,
        Func<string?, bool> isOutputDeviceAvailable,
        Action<string> log)
    {
        var inputDevice = string.IsNullOrWhiteSpace(settings.Audio.InputDevice) ? "default" : settings.Audio.InputDevice;
        var outputDevice = string.IsNullOrWhiteSpace(settings.Audio.OutputDevice) ? "default" : settings.Audio.OutputDevice;
        bool repaired = false;

        if (string.Equals(settings.Audio.CaptureApi, "waveIn", StringComparison.OrdinalIgnoreCase)
            && inputDevice != "default")
        {
            log($"[Audio] waveIn does not support specific input device '{inputDevice}', falling back to default");
            inputDevice = "default";
            repaired = true;
        }

        if (!isInputDeviceAvailable(inputDevice))
        {
            log($"[Audio] Saved input device unavailable: {inputDevice}");
            inputDevice = "default";
            repaired = true;
        }

        if (!isOutputDeviceAvailable(outputDevice))
        {
            log($"[Audio] Saved output device unavailable: {outputDevice}");
            outputDevice = "default";
            repaired = true;
        }

        if (!repaired)
            return (settings, false);

        return (settings with
        {
            Audio = settings.Audio with
            {
                InputDevice = inputDevice,
                OutputDevice = outputDevice,
            }
        }, true);
    }

    public void JoinChannel(uint channelId)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        _pendingLocalJoinChannelId = channelId;
        Connection.SendControl(PacketType.UserState, new UserState { ChannelId = channelId });
        SendPermissionQuery(new PermissionQuery { ChannelId = channelId });
    }

    public void RequestPermissions(uint channelId)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        SendPermissionQuery(new PermissionQuery { ChannelId = channelId });
    }

    public void MuteUser(uint session)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, Mute = true });
    }

    public void UnmuteUser(uint session)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, Mute = false });
    }

    public void DeafenUser(uint session)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, Deaf = true });
    }

    public void UndeafenUser(uint session)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, Deaf = false });
    }

    public void SetPrioritySpeaker(uint session, bool enabled)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, PrioritySpeaker = enabled });
    }

    public void MoveUser(uint session, uint channelId)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { Session = session, ChannelId = channelId });
    }

    public void KickUser(uint session, string? reason = null)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserRemove, new UserRemove { Session = session, Reason = reason ?? "" });
    }

    public void BanUser(uint session, string? reason = null)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserRemove, new UserRemove { Session = session, Reason = reason ?? "", Ban = true });
    }

    /// <summary>
    /// Parses a Brmble API URL from a Mumble server welcome text.
    /// Looks for an HTML comment of the form: &lt;!--brmble:{"apiUrl":"..."}--&gt;
    /// Also accepts single-quoted values: &lt;!--brmble:{'apiUrl':'...'}--&gt;
    /// </summary>
    internal static string? ParseBrmbleApiUrl(string? welcomeText)
    {
        if (string.IsNullOrEmpty(welcomeText))
            return null;

        var match = System.Text.RegularExpressions.Regex.Match(
            welcomeText,
            @"<!--brmble:\{[^}]*?['""]apiUrl['""]\s*:\s*['""]([^'""]+)['""]",
            System.Text.RegularExpressions.RegexOptions.Singleline);

        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>
    /// Rewrites the matrix.homeserverUrl in the credentials JSON to the public API URL
    /// so clients can reach Matrix via the YARP proxy instead of the internal localhost address.
    /// </summary>
    internal static System.Text.Json.JsonElement RewriteMatrixHomeserverUrl(System.Text.Json.JsonElement credentials, string apiUrl)
    {
        using var ms = new MemoryStream();
        using (var writer = new System.Text.Json.Utf8JsonWriter(ms))
        {
            writer.WriteStartObject();
            foreach (var prop in credentials.EnumerateObject())
            {
                if (prop.Name == "matrix" && prop.Value.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    writer.WritePropertyName("matrix");
                    writer.WriteStartObject();
                    foreach (var inner in prop.Value.EnumerateObject())
                    {
                        if (inner.Name == "homeserverUrl")
                            writer.WriteString("homeserverUrl", apiUrl.TrimEnd('/'));
                        else
                            inner.WriteTo(writer);
                    }
                    writer.WriteEndObject();
                }
                else
                {
                    prop.WriteTo(writer);
                }
            }
            writer.WriteEndObject();
        }

        using var doc = System.Text.Json.JsonDocument.Parse(ms.ToArray());
        return doc.RootElement.Clone();
    }

    /// <summary>
    /// Fetches credentials via BouncyCastle managed TLS, bypassing Windows SChannel
    /// which silently refuses to present self-signed client certificates.
    /// </summary>
    private static async Task<(System.Text.Json.JsonElement? Credentials, int StatusCode, string? ErrorBody)> FetchCredentialsViaBcTls(X509Certificate2 cert, Uri tokenUri, string? mumbleUsername = null)
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(tokenUri.Host, tokenUri.Port);

        // Pass DNS hostname for SNI so servers using virtual hosting pick the right cert
        var sniName = tokenUri.HostNameType == UriHostNameType.Dns ? tokenUri.Host : null;
        var tlsClient = new BrmbleTlsClient(cert, sniName);
        var tlsProtocol = new TlsClientProtocol(tcp.GetStream());
        tlsProtocol.Connect(tlsClient);

        try
        {
            var stream = tlsProtocol.Stream;
            // RFC 7230: Host header must include port when non-default
            var hostHeader = tokenUri.IsDefaultPort ? tokenUri.Host : $"{tokenUri.Host}:{tokenUri.Port}";
            var bodyJson = mumbleUsername is not null
                ? System.Text.Json.JsonSerializer.Serialize(new { mumbleUsername })
                : "";
            var contentLength = System.Text.Encoding.UTF8.GetByteCount(bodyJson);
            var contentTypeHeader = contentLength > 0 ? "Content-Type: application/json\r\n" : "";
            var httpRequest = $"POST {tokenUri.PathAndQuery} HTTP/1.1\r\nHost: {hostHeader}\r\n{contentTypeHeader}Content-Length: {contentLength}\r\nConnection: close\r\n\r\n{bodyJson}";
            var requestBytes = System.Text.Encoding.UTF8.GetBytes(httpRequest);
            await stream.WriteAsync(requestBytes, 0, requestBytes.Length);
            await stream.FlushAsync();

            // Read the full response
            using var ms = new MemoryStream();
            var buf = new byte[4096];
            int read;
            try
            {
                while ((read = await stream.ReadAsync(buf, 0, buf.Length)) > 0)
                    ms.Write(buf, 0, read);
            }
            catch (Org.BouncyCastle.Tls.TlsNoCloseNotifyException)
            {
                // Many servers (nginx, caddy, etc.) close without sending close_notify.
                // The response data already in ms is valid — treat as end-of-stream.
            }

            var response = System.Text.Encoding.UTF8.GetString(ms.ToArray());

            // Parse HTTP status line
            var statusEnd = response.IndexOf('\n');
            if (statusEnd < 0)
            {
                Debug.WriteLine("[Brmble:mTLS] No HTTP status line in response");
                return (null, 0, null);
            }

            var statusLine = response[..statusEnd].Trim();
            Debug.WriteLine($"[Brmble:mTLS] BC TLS response: {statusLine}");

            // Parse numeric status code from status line (e.g. "HTTP/1.1 409 Conflict")
            var statusCode = 0;
            var parts = statusLine.Split(' ');
            if (parts.Length >= 2) int.TryParse(parts[1], out statusCode);

            if (statusCode != 200)
            {
                Debug.WriteLine($"[Brmble:mTLS] Non-200 response: {statusLine}");
                // Extract body for error details
                string? errorBody = null;
                var errBodyStart = response.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (errBodyStart < 0)
                    errBodyStart = response.IndexOf("\n\n", StringComparison.Ordinal);
                if (errBodyStart >= 0)
                {
                    var errSepLen = response[errBodyStart] == '\r' ? 4 : 2;
                    errorBody = response[(errBodyStart + errSepLen)..].Trim();
                }
                return (null, statusCode, errorBody);
            }

            // Find body after header separator
            var bodyStart = response.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (bodyStart < 0)
                bodyStart = response.IndexOf("\n\n", StringComparison.Ordinal);
            if (bodyStart < 0)
            {
                Debug.WriteLine("[Brmble:mTLS] No HTTP body found");
                return (null, 200, null);
            }

            var separatorLength = response[bodyStart] == '\r' ? 4 : 2;
            var body = response[(bodyStart + separatorLength)..].Trim();

            // Handle chunked transfer encoding — reassemble chunk data
            var headersSection = response[..bodyStart];
            if (headersSection.Contains("Transfer-Encoding: chunked", StringComparison.OrdinalIgnoreCase))
            {
                var sb = new System.Text.StringBuilder();
                var remaining = body;
                while (remaining.Length > 0)
                {
                    var lineEnd = remaining.IndexOf("\r\n", StringComparison.Ordinal);
                    if (lineEnd < 0) break;

                    var chunkSizeHex = remaining[..lineEnd].Trim();
                    if (!int.TryParse(chunkSizeHex, System.Globalization.NumberStyles.HexNumber, null, out var chunkSize) || chunkSize == 0)
                        break;

                    var chunkStart = lineEnd + 2;
                    if (chunkStart + chunkSize > remaining.Length) break;
                    sb.Append(remaining.AsSpan(chunkStart, chunkSize));
                    remaining = remaining[(chunkStart + chunkSize)..];
                    if (remaining.StartsWith("\r\n"))
                        remaining = remaining[2..];
                }
                body = sb.ToString().Trim();
            }

            if (string.IsNullOrWhiteSpace(body))
                return (null, 200, null);

            using var doc = System.Text.Json.JsonDocument.Parse(body);
            return (doc.RootElement.Clone(), 200, null);
        }
        finally
        {
            tlsProtocol.Close();
        }
    }

    private record TlsResult(bool Success, string? Body, int StatusCode, string? Error);

    /// <summary>
    /// Generic mTLS helper using BouncyCastle TLS.
    /// Returns a structured TlsResult with success/failure details.
    /// </summary>
    private static async Task<TlsResult> SendViaBcTls(X509Certificate2 cert, Uri uri, string httpRequest)
    {
        try
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(uri.Host, uri.Port);

            var sniName = uri.HostNameType == UriHostNameType.Dns ? uri.Host : null;
            var tlsClient = new BrmbleTlsClient(cert, sniName);
            var tlsProtocol = new TlsClientProtocol(tcp.GetStream());
            tlsProtocol.Connect(tlsClient);

            try
            {
                var stream = tlsProtocol.Stream;
                var requestBytes = System.Text.Encoding.UTF8.GetBytes(httpRequest);
                await stream.WriteAsync(requestBytes, 0, requestBytes.Length);
                await stream.FlushAsync();

                using var ms = new MemoryStream();
                var buf = new byte[4096];
                int read;
                try
                {
                    while ((read = await stream.ReadAsync(buf, 0, buf.Length)) > 0)
                        ms.Write(buf, 0, read);
                }
                catch (Org.BouncyCastle.Tls.TlsNoCloseNotifyException) { }

                var response = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                var statusEnd = response.IndexOf('\n');
                if (statusEnd < 0) return new TlsResult(false, null, 0, "No response from server");

                var statusLine = response[..statusEnd].Trim();

                // Parse status code from "HTTP/1.1 200 OK"
                var statusCode = 0;
                var parts = statusLine.Split(' ');
                if (parts.Length >= 2 && !int.TryParse(parts[1], out statusCode))
                    return new TlsResult(false, null, 0, $"Unparseable status line: {statusLine}");

                var bodyStart = response.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (bodyStart < 0) bodyStart = response.IndexOf("\n\n", StringComparison.Ordinal);

                string? body = null;
                if (bodyStart >= 0)
                {
                    var separatorLength = response[bodyStart] == '\r' ? 4 : 2;
                    body = response[(bodyStart + separatorLength)..].Trim();
                }

                if (statusCode < 200 || statusCode >= 300)
                {
                    var errorDetail = string.IsNullOrWhiteSpace(body)
                        ? $"Server returned {statusCode}"
                        : $"Server returned {statusCode}: {body}";
                    return new TlsResult(false, body, statusCode, errorDetail);
                }

                if (body is null)
                    return new TlsResult(true, null, statusCode, null);

                var headersSection = response[..bodyStart];
                if (headersSection.Contains("Transfer-Encoding: chunked", StringComparison.OrdinalIgnoreCase))
                {
                    var sb = new System.Text.StringBuilder();
                    var remaining = body;
                    while (remaining.Length > 0)
                    {
                        var lineEnd = remaining.IndexOf("\r\n", StringComparison.Ordinal);
                        if (lineEnd < 0) break;
                        var chunkSizeHex = remaining[..lineEnd].Trim();
                        if (!int.TryParse(chunkSizeHex, System.Globalization.NumberStyles.HexNumber, null, out var chunkSize) || chunkSize == 0)
                            break;
                        var chunkStart = lineEnd + 2;
                        if (chunkStart + chunkSize > remaining.Length) break;
                        sb.Append(remaining.AsSpan(chunkStart, chunkSize));
                        remaining = remaining[(chunkStart + chunkSize)..];
                        if (remaining.StartsWith("\r\n"))
                            remaining = remaining[2..];
                    }
                    body = sb.ToString().Trim();
                }

                return new TlsResult(true, string.IsNullOrWhiteSpace(body) ? null : body, statusCode, null);
            }
            finally
            {
                tlsProtocol.Close();
            }
        }
        catch (Exception ex)
        {
            return new TlsResult(false, null, 0, ex.Message);
        }
    }

    private static async Task<TlsResult> PostViaBcTls(X509Certificate2 cert, Uri uri, string jsonBody)
    {
        var hostHeader = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        var contentLength = System.Text.Encoding.UTF8.GetByteCount(jsonBody);
        var httpRequest = $"POST {uri.PathAndQuery} HTTP/1.1\r\nHost: {hostHeader}\r\nContent-Type: application/json\r\nContent-Length: {contentLength}\r\nConnection: close\r\n\r\n{jsonBody}";

        return await SendViaBcTls(cert, uri, httpRequest);
    }

    internal static string CreateLiveKitTokenRequestBody(string roomName, string accessMode)
    {
        var normalizedAccessMode = accessMode.Trim().ToLowerInvariant() switch
        {
            "publish" => "publish",
            "subscribe" => "subscribe",
            _ => throw new ArgumentOutOfRangeException(nameof(accessMode), accessMode, null),
        };

        return System.Text.Json.JsonSerializer.Serialize(new { roomName, accessMode = normalizedAccessMode });
    }

    internal static bool TryGetLiveKitAccessMode(System.Text.Json.JsonElement data, [NotNullWhen(true)] out string? accessMode)
    {
        accessMode = null;

        if (!data.TryGetProperty("accessMode", out var modeElement) || modeElement.ValueKind != System.Text.Json.JsonValueKind.String)
            return false;

        accessMode = modeElement.GetString();
        return !string.IsNullOrWhiteSpace(accessMode);
    }

    internal sealed record ChannelChangedPayload(
        uint ChannelId,
        uint? PreviousChannelId,
        uint? ActorSession,
        string? ActorName,
        string Reason);

    internal sealed record BrmbleServiceStatusPayload(
        string Service,
        string State,
        string? Reason = null,
        int? Attempt = null,
        int? DelayMs = null);

    internal static ChannelChangedPayload CreateChannelChangedPayload(
        uint? previousChannelId,
        uint currentChannelId,
        uint? actorSession,
        string? actorName,
        bool movedByOtherUser)
    {
        return new ChannelChangedPayload(
            currentChannelId,
            previousChannelId,
            actorSession,
            string.IsNullOrWhiteSpace(actorName) ? null : actorName,
            movedByOtherUser ? "moved" : "unknown");
    }

    internal static BrmbleServiceStatusPayload CreateBrmbleServiceStatusPayload(
        string service,
        string state,
        string? reason = null,
        int? attempt = null,
        int? delayMs = null)
        => new(service, state, reason, attempt, delayMs);

    internal static bool ShouldRefreshCredentialsAfterHealthSuccess(
        bool credentialsAlreadyFetched,
        bool previousHealthWasConnected,
        bool sawHealthFailureSinceCredentials)
        => credentialsAlreadyFetched && !previousHealthWasConnected && sawHealthFailureSinceCredentials;

    internal static bool ShouldEmitSessionStoppedStatus(
        bool isCancellationRequested,
        long currentGeneration,
        long taskGeneration)
        => isCancellationRequested && currentGeneration == taskGeneration;

    internal sealed record ServerRemovalPayload(
        string Reason,
        string ActorName,
        string? Message,
        bool ReconnectAvailable);

    internal static ServerRemovalPayload CreateServerRemovalPayload(bool banned, string? actorName, string? reason)
    {
        return new ServerRemovalPayload(
            banned ? "banned" : "kicked",
            string.IsNullOrWhiteSpace(actorName) ? "the server" : actorName,
            string.IsNullOrWhiteSpace(reason) ? null : reason,
            true);
    }

    private static async Task<TlsResult> GetViaBcTls(X509Certificate2 cert, Uri uri)
    {
        var hostHeader = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        var httpRequest = $"GET {uri.PathAndQuery} HTTP/1.1\r\nHost: {hostHeader}\r\nConnection: close\r\n\r\n";
        return await SendViaBcTls(cert, uri, httpRequest);
    }

    private static readonly string LiveKitLogPath =
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "brmble-livekit.log");

    private const long MaxLogSize = 1024 * 1024; // 1 MB

    private static void LogToFile(string message)
    {
        try
        {
            var fi = new System.IO.FileInfo(LiveKitLogPath);
            if (fi.Exists && fi.Length > MaxLogSize)
                System.IO.File.Delete(LiveKitLogPath);

            System.IO.File.AppendAllText(LiveKitLogPath,
                $"[{DateTime.Now:HH:mm:ss.fff}] {message}\n");
        }
        catch { /* logging should never throw */ }
    }

    private void SendBrmbleServiceStatus(
        string service,
        string state,
        string? reason = null,
        int? attempt = null,
        int? delayMs = null)
    {
        _bridge?.Send("brmble.serviceStatus", CreateBrmbleServiceStatusPayload(service, state, reason, attempt, delayMs));
        _bridge?.NotifyUiThread();
    }

    /// Pure HTTP helper: POSTs to /auth/token and returns the parsed response body.
    /// Body is empty — identity comes from the TLS client certificate attached to <paramref name="httpClient"/>.
    /// Returns null on any non-success status.
    /// </summary>
    internal static async Task<System.Text.Json.JsonElement?> FetchCredentials(string apiUrl, HttpClient httpClient)
    {
        var baseUri = new System.Uri(apiUrl, System.UriKind.Absolute);
        var tokenUri = new System.Uri(baseUri, "auth/token");

        using var response = await httpClient.PostAsync(tokenUri, content: null);
        if (!response.IsSuccessStatusCode)
            return null;

        var json = await response.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private async Task FetchAndSendCredentials(string apiUrl)
    {
        // Load with Exportable so BouncyCastle can extract private key parameters for signing
        using var cert = _certService?.GetExportableCertificate();
        if (cert is null)
        {
            _bridge?.Send("voice.error", new { message = "No client certificate — cannot fetch Matrix credentials." });
            _bridge?.NotifyUiThread();
            return;
        }

        try
        {
            var baseUri = new Uri(apiUrl, UriKind.Absolute);
            var tokenUri = new Uri(baseUri, "auth/token");

            var (credentials, httpStatus, errorBody) = await FetchCredentialsViaBcTls(cert, tokenUri, _reconnectUsername);
            if (credentials is null)
            {
                if (httpStatus == 409)
                {
                    // Name conflict — parse error body and send to frontend
                    try
                    {
                        string? conflictName = null;
                        string? conflictMsg = null;
                        if (errorBody is not null)
                        {
                            using var errorDoc = System.Text.Json.JsonDocument.Parse(errorBody);
                            var errorRoot = errorDoc.RootElement;
                            conflictMsg = errorRoot.TryGetProperty("message", out var msg) ? msg.GetString() : null;
                            conflictName = errorRoot.TryGetProperty("name", out var n) ? n.GetString() : null;
                        }
                        _bridge?.Send("voice.authError", new
                        {
                            error = "name_taken",
                            message = conflictMsg ?? "Username already taken",
                            name = conflictName
                        });
                        _bridge?.NotifyUiThread();
                    }
                    catch
                    {
                        _bridge?.Send("voice.authError", new { error = "name_taken", message = "Username already taken" });
                        _bridge?.NotifyUiThread();
                    }
                }
                else if (httpStatus == 503)
                {
                    _bridge?.Send("voice.authError", new
                    {
                        error = "registration_unavailable",
                        message = "Mumble registration service is temporarily unavailable. Please try again."
                    });
                    _bridge?.NotifyUiThread();
                }
                return;
            }

            // Parse user mappings (displayName -> matrixUserId) from the auth response
            if (credentials.Value.TryGetProperty("userMappings", out var mappingsElement))
            {
                _userMappings = new Dictionary<string, string>();
                foreach (var prop in mappingsElement.EnumerateObject())
                {
                    var matrixId = prop.Value.GetString();
                    if (matrixId is not null)
                        _userMappings[prop.Name] = matrixId;
                }
            }

            // Parse session mappings (sessionId -> matrixUserId + mumbleName) from the auth response
            if (credentials.Value.TryGetProperty("sessionMappings", out var sessionMappingsElement))
            {
                _sessionMappings.Clear();
                foreach (var (sid, entry) in ParseSessionMappings(sessionMappingsElement))
                    _sessionMappings[sid] = entry;
            }

            // The server returns its internal homeserverUrl (e.g. http://localhost:6167).
            // Clients reach Matrix via the YARP proxy on the same Brmble API URL,
            // so rewrite homeserverUrl to the API URL the client connected to.
            var rewritten = RewriteMatrixHomeserverUrl(credentials.Value, apiUrl);
            _bridge?.Send("server.credentials", rewritten);
            _bridge?.NotifyUiThread();
            _apiUrl = apiUrl;
            _credentialsAlreadyFetched = true;
            _sawServerHealthFailureSinceCredentials = false;
            SendBrmbleServiceStatus("server", "connected");

            // Start WebSocket connection for real-time session mapping updates
            StartWebSocketConnection(apiUrl);

            // Start periodic health checks (runs from C# to avoid CORS issues)
            StartHealthCheck(apiUrl);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Matrix] Failed to fetch credentials: {ex.Message}");
            _bridge?.Send("voice.error", new { message = $"Failed to fetch chat credentials: {ex.Message}" });
            _bridge?.NotifyUiThread();
        }
    }

    private async Task GetRegisteredUsersAsync()
    {
        if (string.IsNullOrWhiteSpace(_apiUrl))
        {
            _bridge?.Send("voice.registeredUsers", Array.Empty<object>());
            _bridge?.NotifyUiThread();
            return;
        }

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var response = await _healthHttpClient.GetAsync($"{_apiUrl.TrimEnd('/')}/admin/registered-users", cts.Token);
            if (!response.IsSuccessStatusCode)
            {
                _bridge?.Send("voice.registeredUsers", Array.Empty<object>());
                _bridge?.NotifyUiThread();
                return;
            }

            var json = await response.Content.ReadAsStringAsync();
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            _bridge?.Send("voice.registeredUsers", doc.RootElement);
            _bridge?.NotifyUiThread();
        }
        catch
        {
            _bridge?.Send("voice.registeredUsers", Array.Empty<object>());
            _bridge?.NotifyUiThread();
        }
    }

    private string GetSelfCompanionOrDefault()
    {
        if (LocalUser is not null &&
            _sessionMappings.TryGetValue(LocalUser.Id, out var mapping) &&
            !string.IsNullOrWhiteSpace(mapping.CompanionId))
        {
            return mapping.CompanionId;
        }

        return "floppy";
    }

    private void UpdateSelfCompanionMapping(string companionId)
    {
        if (LocalUser is null) return;
        if (_sessionMappings.TryGetValue(LocalUser.Id, out var existing))
        {
            _sessionMappings[LocalUser.Id] = existing with { CompanionId = companionId };
        }
    }

    private async Task<object> SyncCompanionAsync(string companionId)
    {
        if (string.IsNullOrWhiteSpace(_apiUrl))
            return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Brmble API unavailable" };

        using var cert = _certService?.GetExportableCertificate();
        if (cert is null)
            return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Client certificate unavailable" };

        try
        {
            var baseUri = new Uri(_apiUrl, UriKind.Absolute);
            var uri = new Uri(baseUri, "auth/companion");
            var jsonBody = System.Text.Json.JsonSerializer.Serialize(new { companionId });
            var result = await PostViaBcTls(cert, uri, jsonBody);
            if (!result.Success)
            {
                string errorMessage = "Failed to sync companion";
                
                // Try to parse JSON error response
                if (!string.IsNullOrWhiteSpace(result.Body))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
                        if (doc.RootElement.TryGetProperty("error", out var errorProp) && errorProp.GetString() is { } errMsg)
                            errorMessage = errMsg;
                        else
                            errorMessage = result.Body; // fallback to raw body if no error field
                    }
                    catch
                    {
                        errorMessage = result.Body; // fallback to raw body on parse failure
                    }
                }
                else if (!string.IsNullOrWhiteSpace(result.Error))
                {
                    errorMessage = result.Error;
                }
                
                return new
                {
                    success = false,
                    companionId = GetSelfCompanionOrDefault(),
                    error = errorMessage
                };
            }

            var synced = companionId;
            if (!string.IsNullOrWhiteSpace(result.Body))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
                if (doc.RootElement.TryGetProperty("companionId", out var syncedProp) && syncedProp.GetString() is { } value)
                    synced = value;
            }

            UpdateSelfCompanionMapping(synced);
            return new { success = true, companionId = synced };
        }
        catch (Exception ex)
        {
            LogToFile($"[Companion] sync failed: {ex.Message}");
            return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Failed to sync companion" };
        }
    }

    private void StartHealthCheck(string apiUrl)
    {
        StopHealthCheck();
        var url = apiUrl.TrimEnd('/') + "/health";
        var gen = Interlocked.Increment(ref _healthGeneration);

        // Immediately report connecting, then run first check
        _bridge?.Send("server.healthStatus", new { state = "connecting", label = apiUrl });
        _bridge?.NotifyUiThread();

        _healthTimer = new System.Threading.Timer(async _ =>
        {
            if (Interlocked.Read(ref _healthGeneration) != gen) return;
            try
            {
                using var res = await _healthHttpClient.GetAsync(url);
                if (Interlocked.Read(ref _healthGeneration) != gen) return;
                if (res.IsSuccessStatusCode)
                {
                    var version = await TryReadVersionAsync(res);
                    var shouldRefreshCredentials = ShouldRefreshCredentialsAfterHealthSuccess(
                        _credentialsAlreadyFetched,
                        _serverHealthWasConnected,
                        _sawServerHealthFailureSinceCredentials);

                    _serverHealthWasConnected = true;
                    _sawServerHealthFailureSinceCredentials = false;
                    _bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl, version });
                    SendBrmbleServiceStatus("server", "connected");

                    if (shouldRefreshCredentials)
                    {
                        _ = Task.Run(() => FetchAndSendCredentials(apiUrl));
                    }
                }
                else
                {
                    _serverHealthWasConnected = false;
                    _sawServerHealthFailureSinceCredentials = true;
                    SendBrmbleServiceStatus("server", "reconnecting", reason: $"http-{(int)res.StatusCode}");
                    _bridge?.Send("server.healthStatus", new { state = "disconnected", error = $"Health check returned {(int)res.StatusCode}" });
                }
            }
            catch (Exception ex)
            {
                if (Interlocked.Read(ref _healthGeneration) != gen) return;
                _serverHealthWasConnected = false;
                _sawServerHealthFailureSinceCredentials = true;
                SendBrmbleServiceStatus("server", "reconnecting", reason: "connection-lost");
                _bridge?.Send("server.healthStatus", new { state = "disconnected", error = ex.Message });
            }
            _bridge?.NotifyUiThread();
        }, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    private void StopHealthCheck()
    {
        Interlocked.Increment(ref _healthGeneration);
        _healthTimer?.Dispose();
        _healthTimer = null;
    }

    private static async Task<string?> TryReadVersionAsync(HttpResponseMessage res)
    {
        try
        {
            var body = await res.Content.ReadAsStringAsync();
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("version", out var prop) &&
                prop.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var v = prop.GetString();
                return string.IsNullOrWhiteSpace(v) ? null : v;
            }
        }
        catch
        {
            // Non-JSON, missing field, or transient parse failure — fall back to no version.
        }
        return null;
    }

    private void StartWebSocketConnection(string apiUrl)
    {
        var wsGeneration = Interlocked.Increment(ref _wsGeneration);
        var old = _wsCts;
        old?.Cancel();
        old?.Dispose();
        _wsCts = new CancellationTokenSource();
        SendBrmbleServiceStatus("session", "connecting");
        var ct = _wsCts.Token;

        var builder = new UriBuilder(apiUrl);
        // Keep the original scheme for TCP connection; we do TLS via BouncyCastle
        var host = builder.Host;
        var port = builder.Port > 0 ? builder.Port : (builder.Scheme == "https" ? 443 : 80);
        var wsPath = builder.Path.TrimEnd('/') + "/ws";

        _ = Task.Run(async () =>
        {
            var backoff = TimeSpan.FromSeconds(1);
            var maxBackoff = TimeSpan.FromSeconds(30);

            while (!ct.IsCancellationRequested)
            {
                TlsClientProtocol? tlsProtocol = null;
                TcpClient? tcp = null;
                try
                {
                    using var cert = _certService?.GetExportableCertificate();
                    if (cert is null)
                    {
                        Debug.WriteLine("[WS] No client certificate available, retrying...");
                        if (ct.IsCancellationRequested) break;
                        try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { break; }
                        backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
                        continue;
                    }

                    // Connect via BouncyCastle TLS (bypasses SChannel self-signed cert issue)
                    tcp = new TcpClient();
                    await tcp.ConnectAsync(host, port);

                    var sniName = Uri.CheckHostName(host) == UriHostNameType.Dns ? host : null;
                    var tlsClient = new BrmbleTlsClient(cert, sniName);
                    tlsProtocol = new TlsClientProtocol(tcp.GetStream());
                    tlsProtocol.Connect(tlsClient);

                    var stream = tlsProtocol.Stream;

                    // Perform WebSocket upgrade handshake
                    var wsKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
                    var hostHeader = port == 443 ? host : $"{host}:{port}";
                    var upgradeRequest =
                        $"GET {wsPath} HTTP/1.1\r\n" +
                        $"Host: {hostHeader}\r\n" +
                        $"Upgrade: websocket\r\n" +
                        $"Connection: Upgrade\r\n" +
                        $"Sec-WebSocket-Key: {wsKey}\r\n" +
                        $"Sec-WebSocket-Version: 13\r\n" +
                        $"\r\n";

                    var requestBytes = System.Text.Encoding.UTF8.GetBytes(upgradeRequest);
                    await stream.WriteAsync(requestBytes, 0, requestBytes.Length);
                    await stream.FlushAsync();

                    // Read the HTTP upgrade response (headers end with \r\n\r\n)
                    var headerBuf = new byte[4096];
                    var headerLen = 0;
                    while (headerLen < headerBuf.Length)
                    {
                        var b = await stream.ReadAsync(headerBuf, headerLen, 1);
                        if (b == 0) break;
                        headerLen++;
                        if (headerLen >= 4 &&
                            headerBuf[headerLen - 4] == '\r' && headerBuf[headerLen - 3] == '\n' &&
                            headerBuf[headerLen - 2] == '\r' && headerBuf[headerLen - 1] == '\n')
                            break;
                    }

                    var responseHeader = System.Text.Encoding.UTF8.GetString(headerBuf, 0, headerLen);

                    // Parse HTTP status line and headers to validate WebSocket upgrade
                    var headerLines = responseHeader.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                    if (headerLines.Length == 0)
                    {
                        Debug.WriteLine("[WS] Upgrade failed: empty HTTP response");
                        throw new InvalidOperationException("WebSocket upgrade rejected");
                    }

                    var statusLine = headerLines[0];
                    if (!statusLine.StartsWith("HTTP/1.1 101", StringComparison.Ordinal))
                    {
                        Debug.WriteLine($"[WS] Upgrade failed: {statusLine}");
                        throw new InvalidOperationException("WebSocket upgrade rejected");
                    }

                    // Build a case-insensitive header dictionary
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (var i = 1; i < headerLines.Length; i++)
                    {
                        var line = headerLines[i];
                        var colonIndex = line.IndexOf(':');
                        if (colonIndex <= 0) continue;
                        var name = line.Substring(0, colonIndex).Trim();
                        var value = line.Substring(colonIndex + 1).Trim();
                        if (name.Length == 0) continue;
                        headers[name] = value;
                    }

                    if (!headers.TryGetValue("Sec-WebSocket-Accept", out var acceptHeader))
                    {
                        Debug.WriteLine($"[WS] Upgrade failed: missing Sec-WebSocket-Accept header ({statusLine})");
                        throw new InvalidOperationException("WebSocket upgrade rejected");
                    }

                    // Compute the expected Sec-WebSocket-Accept value
                    const string websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
                    var acceptSource = System.Text.Encoding.ASCII.GetBytes(wsKey + websocketGuid);
                    string expectedAccept;
                    using (var sha1 = System.Security.Cryptography.SHA1.Create())
                    {
                        var hash = sha1.ComputeHash(acceptSource);
                        expectedAccept = Convert.ToBase64String(hash);
                    }

                    if (!string.Equals(acceptHeader, expectedAccept, StringComparison.Ordinal))
                    {
                        Debug.WriteLine($"[WS] Upgrade failed: invalid Sec-WebSocket-Accept ({statusLine})");
                        throw new InvalidOperationException("WebSocket upgrade rejected");
                    }

                    backoff = TimeSpan.FromSeconds(1); // reset on successful connect
                    Debug.WriteLine("[WS] Connected to Brmble WebSocket (BouncyCastle TLS)");
                    SendBrmbleServiceStatus("session", "connected");

                    // Read WebSocket frames
                    while (!ct.IsCancellationRequested)
                    {
                        var message = await ReadWebSocketFrame(stream, ct);
                        if (message is null) break; // connection closed
                        HandleWebSocketMessage(message);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[WS] Error: {ex.Message}");
                }
                finally
                {
                    try { tlsProtocol?.Close(); } catch { }
                    try { tcp?.Dispose(); } catch { }
                }

                if (ct.IsCancellationRequested) break;

                SendBrmbleServiceStatus("session", "reconnecting", reason: "connection-lost", delayMs: (int)backoff.TotalMilliseconds);
                Debug.WriteLine($"[WS] Reconnecting in {backoff.TotalSeconds}s...");
                try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { break; }
                backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
            }

            if (ShouldEmitSessionStoppedStatus(ct.IsCancellationRequested, Interlocked.Read(ref _wsGeneration), wsGeneration))
            {
                SendBrmbleServiceStatus("session", "disconnected", reason: "stopped");
            }
        }, ct);
    }

    /// <summary>
    /// Reads a single WebSocket text frame from the stream.
    /// Handles continuation frames, ping/pong, and close frames.
    /// Returns null on connection close.
    /// </summary>
    private static async Task<string?> ReadWebSocketFrame(Stream stream, CancellationToken ct)
    {
        using var payload = new MemoryStream();

        while (true)
        {
            // Read the 2-byte frame header
            var header = new byte[2];
            if (!await ReadExactAsync(stream, header, 0, 2, ct))
                return null;

            var fin = (header[0] & 0x80) != 0;
            var opcode = header[0] & 0x0F;
            var masked = (header[1] & 0x80) != 0;
            long payloadLen = header[1] & 0x7F;

            if (payloadLen == 126)
            {
                var ext = new byte[2];
                if (!await ReadExactAsync(stream, ext, 0, 2, ct)) return null;
                payloadLen = (ext[0] << 8) | ext[1];
            }
            else if (payloadLen == 127)
            {
                var ext = new byte[8];
                if (!await ReadExactAsync(stream, ext, 0, 8, ct)) return null;
                payloadLen = 0;
                for (int i = 0; i < 8; i++)
                    payloadLen = (payloadLen << 8) | ext[i];
            }

            byte[]? maskKey = null;
            if (masked)
            {
                maskKey = new byte[4];
                if (!await ReadExactAsync(stream, maskKey, 0, 4, ct)) return null;
            }

            // Read frame payload
            const long MaxPayloadSize = 16 * 1024 * 1024; // 16 MB
            if (payloadLen > MaxPayloadSize)
            {
                Debug.WriteLine($"[WS] Frame too large ({payloadLen} bytes), closing");
                return null;
            }
            if (payloadLen > 0)
            {
                var frameBuf = new byte[(int)payloadLen];
                if (!await ReadExactAsync(stream, frameBuf, 0, (int)payloadLen, ct)) return null;

                if (maskKey != null)
                    for (int i = 0; i < frameBuf.Length; i++)
                        frameBuf[i] ^= maskKey[i % 4];

                // Handle control frames
                if (opcode == 0x9) // Ping
                {
                    // Send Pong with same payload (must be masked from client)
                    await SendWebSocketFrame(stream, 0xA, frameBuf);
                    continue;
                }

                if (opcode == 0x8) // Close
                    return null;

                if (opcode == 0xA) // Pong — ignore
                    continue;

                payload.Write(frameBuf, 0, frameBuf.Length);
            }
            else
            {
                if (opcode == 0x9) // Ping with empty payload
                {
                    await SendWebSocketFrame(stream, 0xA, Array.Empty<byte>());
                    continue;
                }
                if (opcode == 0x8) return null;
                if (opcode == 0xA) continue;
            }

            if (fin)
            {
                return System.Text.Encoding.UTF8.GetString(payload.GetBuffer(), 0, (int)payload.Length);
            }
        }
    }

    /// <summary>
    /// Sends a masked WebSocket frame (client-to-server frames must be masked per RFC 6455).
    /// </summary>
    private static async Task SendWebSocketFrame(Stream stream, int opcode, byte[] data)
    {
        // Client frames must be masked
        var maskKey = System.Security.Cryptography.RandomNumberGenerator.GetBytes(4);

        using var frame = new MemoryStream();
        frame.WriteByte((byte)(0x80 | opcode)); // FIN + opcode

        if (data.Length < 126)
            frame.WriteByte((byte)(0x80 | data.Length)); // masked + length
        else if (data.Length <= 65535)
        {
            frame.WriteByte(0x80 | 126);
            frame.WriteByte((byte)(data.Length >> 8));
            frame.WriteByte((byte)(data.Length & 0xFF));
        }
        else
        {
            frame.WriteByte(0x80 | 127);
            var len = (long)data.Length;
            for (int i = 7; i >= 0; i--)
                frame.WriteByte((byte)((len >> (i * 8)) & 0xFF));
        }

        frame.Write(maskKey, 0, 4);

        var masked = new byte[data.Length];
        for (int i = 0; i < data.Length; i++)
            masked[i] = (byte)(data[i] ^ maskKey[i % 4]);
        frame.Write(masked, 0, masked.Length);

        var bytes = frame.ToArray();
        await stream.WriteAsync(bytes, 0, bytes.Length);
        await stream.FlushAsync();
    }

    /// <summary>Reads exactly count bytes from stream. Returns false on EOF.</summary>
    private static async Task<bool> ReadExactAsync(Stream stream, byte[] buffer, int offset, int count, CancellationToken ct)
    {
        int totalRead = 0;
        while (totalRead < count)
        {
            ct.ThrowIfCancellationRequested();
            var read = await stream.ReadAsync(buffer, offset + totalRead, count - totalRead);
            if (read == 0) return false;
            totalRead += read;
        }
        return true;
    }

    private void HandleWebSocketMessage(string json)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

            switch (type)
            {
                case "sessionMappingSnapshot":
                    _sessionMappings.Clear();
                    if (root.TryGetProperty("mappings", out var mappings))
                    {
                        foreach (var (sid, entry) in ParseSessionMappings(mappings))
                            _sessionMappings[sid] = entry;
                    }
                    _bridge?.Send("voice.sessionMappingSnapshot",
                        new
                        {
                            mappings = _sessionMappings.ToDictionary(k => k.Key, k => new
                            {
                                k.Value.MatrixUserId,
                                k.Value.MumbleName,
                                k.Value.CompanionId,
                                k.Value.IsBrmbleClient
                            })
                        });
                    _bridge?.NotifyUiThread();
                    break;

                case "userMappingAdded":
                    var addSid = root.TryGetProperty("sessionId", out var sidProp) ? sidProp.GetUInt32() : 0u;
                    var addMatrixId = root.TryGetProperty("matrixUserId", out var matrixProp) ? matrixProp.GetString() : null;
                    var addName = root.TryGetProperty("mumbleName", out var nameProp) ? nameProp.GetString() : null;
                    var addCompanionId = root.TryGetProperty("companionId", out var companionProp) ? companionProp.GetString() : "floppy";
                    var addIsBrmble = root.TryGetProperty("isBrmbleClient", out var brmbleProp) && brmbleProp.GetBoolean();
                    if (addSid > 0 && addMatrixId is not null && addName is not null && addCompanionId is not null)
                    {
                        _sessionMappings[addSid] = new SessionMappingEntry(addMatrixId, addName, addCompanionId, addIsBrmble);
                        _bridge?.Send("voice.userMappingUpdated", new { sessionId = addSid, matrixUserId = addMatrixId, mumbleName = addName, companionId = addCompanionId, isBrmbleClient = addIsBrmble, action = "added" });
                        _bridge?.NotifyUiThread();
                    }
                    break;

                case "companionChanged":
                    var changedSid = root.GetProperty("sessionId").GetUInt32();
                    var changedCompanionId = root.GetProperty("companionId").GetString() ?? "floppy";
                    if (_sessionMappings.TryGetValue(changedSid, out var changed))
                        _sessionMappings[changedSid] = changed with { CompanionId = changedCompanionId };
                    _bridge?.Send("voice.companionChanged", new
                    {
                        session = changedSid,
                        matrixUserId = root.TryGetProperty("matrixUserId", out var matrixIdProp) ? matrixIdProp.GetString() : null,
                        companionId = changedCompanionId
                    });
                    _bridge?.NotifyUiThread();
                    break;

                case "userMappingRemoved":
                    var rmSid = root.TryGetProperty("sessionId", out var rmSidProp) ? rmSidProp.GetUInt32() : 0u;
                    if (rmSid > 0)
                    {
                        _sessionMappings.TryRemove(rmSid, out _);
                        _bridge?.Send("voice.userMappingUpdated", new { sessionId = rmSid, action = "removed" });
                        _bridge?.NotifyUiThread();
                    }
                    break;

                case "brmbleClientActivated":
                    var actSid = root.TryGetProperty("sessionId", out var actSidProp) ? actSidProp.GetUInt32() : 0u;
                    if (actSid > 0 && _sessionMappings.TryGetValue(actSid, out var actEntry))
                    {
                        _sessionMappings[actSid] = actEntry with { IsBrmbleClient = true };
                    }
                    _bridge?.Send("voice.brmbleClientActivated", new { sessionId = actSid });
                    _bridge?.NotifyUiThread();
                    break;

                case "brmbleClientDeactivated":
                    var deactSid = root.TryGetProperty("sessionId", out var deactSidProp) ? deactSidProp.GetUInt32() : 0u;
                    if (deactSid > 0 && _sessionMappings.TryGetValue(deactSid, out var deactEntry))
                    {
                        _sessionMappings[deactSid] = deactEntry with { IsBrmbleClient = false };
                    }
                    _bridge?.Send("voice.brmbleClientDeactivated", new { sessionId = deactSid });
                    _bridge?.NotifyUiThread();
                    break;

                case "screenShare.started":
                    var startRoom = root.TryGetProperty("roomName", out var startRoomProp) ? startRoomProp.GetString() : null;
                    var startUser = root.TryGetProperty("userName", out var startUserProp) ? startUserProp.GetString() : null;
                    var startUserId = root.TryGetProperty("userId", out var startUserIdProp) && startUserIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? startUserIdProp.GetInt64() : (long?)null;
                    var startMatrixUserId = root.TryGetProperty("matrixUserId", out var startMatrixProp) ? startMatrixProp.GetString() : null;
                    var startSession = root.TryGetProperty("sessionId", out var startSessionProp) && startSessionProp.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? startSessionProp.GetInt32() : (int?)null;
                    if (startRoom is not null)
                    {
                        _bridge?.Send("livekit.screenShareStarted", new { roomName = startRoom, userName = startUser, userId = startUserId, matrixUserId = startMatrixUserId, sessionId = startSession });
                        _bridge?.NotifyUiThread();
                    }
                    break;

                case "screenShare.stopped":
                    var stopRoom = root.TryGetProperty("roomName", out var stopRoomProp) ? stopRoomProp.GetString() : null;
                    var stopUserId = root.TryGetProperty("userId", out var stopUserIdProp) && stopUserIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? stopUserIdProp.GetInt64() : (long?)null;
                    if (stopRoom is not null)
                    {
                        _bridge?.Send("livekit.screenShareStopped", new { roomName = stopRoom, userId = stopUserId });
                        _bridge?.NotifyUiThread();
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WS] Failed to handle message: {ex.Message}");
        }
    }

    public async Task ConnectViaBrmbleServer(string apiUrl, string username, string password = "")
    {
        try
        {
            using var http = new System.Net.Http.HttpClient();
            var response = await http.GetAsync($"{apiUrl}/server-info");
            response.EnsureSuccessStatusCode();

            var json = System.Text.Json.JsonDocument.Parse(
                await response.Content.ReadAsStringAsync()).RootElement;

            var host = json.GetProperty("mumbleHost").GetString()
                ?? throw new InvalidOperationException("server-info missing mumbleHost");
            var port = json.GetProperty("mumblePort").GetInt32();

            _reconnectHost = host;
            _reconnectPort = port;
            _reconnectUsername = username;
            _reconnectPassword = password;

            await Task.Run(() => Connect(host, port, username, password, apiUrl));
        }
        catch (Exception ex)
        {
            _bridge?.Send("voice.error", new { message = $"Failed to reach Brmble server: {ex.Message}" });
            _bridge?.NotifyUiThread();
        }
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("voice.connect", async data =>
        {
            var h      = data.TryGetProperty("host",     out var host) ? host.GetString()  ?? "" : "";
            var p      = data.TryGetProperty("port",     out var port) ? port.GetInt32()        : 0;
            var u      = data.TryGetProperty("username", out var user) ? user.GetString()  ?? "" : "";
            var pw     = data.TryGetProperty("password", out var pass) ? pass.GetString()  ?? "" : "";
            var apiUrl = data.TryGetProperty("apiUrl",   out var a)    ? a.GetString()          : null;
            _activeServerId = data.TryGetProperty("id",  out var sid)  ? sid.GetString()         : null;

            _intentionalDisconnect = false;
            _rejected = false;

            if (!string.IsNullOrEmpty(apiUrl) && string.IsNullOrEmpty(h))
            {
                await ConnectViaBrmbleServer(apiUrl, u, pw);
            }
            else
            {
                _reconnectHost = h;
                _reconnectPort = p;
                _reconnectUsername = u;
                _reconnectPassword = pw;
                _ = Task.Run(() => Connect(h, p, u, pw, apiUrl));
            }
        });

        bridge.RegisterHandler("voice.disconnect", _ =>
        {
            _intentionalDisconnect = true;
            _reconnectCts?.Cancel();
            Disconnect();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.cancelReconnect", _ =>
        {
            _intentionalDisconnect = true;
            _reconnectCts?.Cancel();
            _bridge?.Send("voice.disconnected", null);
            _bridge?.NotifyUiThread();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.sendMessage", data =>
        {
            if (data.TryGetProperty("message", out var message))
            {
                uint? channelId = null;
                if (data.TryGetProperty("channelId", out var cid))
                {
                    channelId = cid.GetUInt32();
                }
                SendTextMessage(message.GetString() ?? "", channelId);
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.sendPrivateMessage", data =>
        {
            if (data.TryGetProperty("message", out var message) &&
                data.TryGetProperty("targetSession", out var session))
            {
                SendPrivateMessage(message.GetString() ?? "", session.GetUInt32());
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.joinChannel", data =>
        {
            if (data.TryGetProperty("channelId", out var id))
                JoinChannel(id.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.toggleMute", _ => { ToggleMute(); return Task.CompletedTask; });
        bridge.RegisterHandler("voice.toggleDeaf", _ => { ToggleDeaf(); return Task.CompletedTask; });
        bridge.RegisterHandler("voice.leaveVoice", _ => { LeaveVoice(); return Task.CompletedTask; });

        bridge.RegisterHandler("voice.setTransmissionMode", data =>
        {
            var mode = data.TryGetProperty("mode", out var m) ? m.GetString() ?? "continuous" : "continuous";
            var key  = data.TryGetProperty("key",  out var k) ? k.GetString() : null;
            SetTransmissionMode(mode, key);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.setShortcut", data =>
        {
            var action = data.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            var key = data.TryGetProperty("key", out var k) ? k.GetString() : null;
            _inputRouter?.SetShortcutBinding(action, key);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.suspendHotkeys", _ =>
        {
            _inputRouter?.Suspend();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.resumeHotkeys", _ =>
        {
            _inputRouter?.Resume();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.getAudioDevices", _ =>
        {
            var payload = _audioManager?.GetAudioDevices()
                ?? new AudioDevicesPayload(
                    [new AudioDeviceOption("default", "Default (System)")],
                    [new AudioDeviceOption("default", "Default (System)")]);
            _bridge?.Send("voice.audioDevices", payload);
            _bridge?.NotifyUiThread();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.pttKey", data =>
        {
            var pressed = data.TryGetProperty("pressed", out var p) && p.GetBoolean();
            _inputRouter?.HandleJsPttKey(pressed);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.mute", data =>
        {
            if (data.TryGetProperty("session", out var session))
                MuteUser(session.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.unmute", data =>
        {
            if (data.TryGetProperty("session", out var session))
                UnmuteUser(session.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.deafen", data =>
        {
            if (data.TryGetProperty("session", out var session))
                DeafenUser(session.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.undeafen", data =>
        {
            if (data.TryGetProperty("session", out var session))
                UndeafenUser(session.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.setPrioritySpeaker", data =>
        {
            if (data.TryGetProperty("session", out var session) && data.TryGetProperty("enabled", out var enabled))
                SetPrioritySpeaker(session.GetUInt32(), enabled.GetBoolean());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.move", data =>
        {
            if (data.TryGetProperty("session", out var session) && data.TryGetProperty("channelId", out var channelId))
                MoveUser(session.GetUInt32(), channelId.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.kick", data =>
        {
            if (data.TryGetProperty("session", out var session))
            {
                var reason = data.TryGetProperty("reason", out var r) ? r.GetString() : null;
                KickUser(session.GetUInt32(), reason);
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.ban", data =>
        {
            if (data.TryGetProperty("session", out var session))
            {
                var reason = data.TryGetProperty("reason", out var r) ? r.GetString() : null;
                BanUser(session.GetUInt32(), reason);
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.requestPermissions", data =>
        {
            if (data.TryGetProperty("channelId", out var channelId))
                RequestPermissions(channelId.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.setVolume", data =>
        {
            if (data.TryGetProperty("session", out var session) && data.TryGetProperty("volume", out var volume))
            {
                SetUserVolume(session.GetUInt32(), volume.GetInt32());
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.setLocalMute", data =>
        {
            if (data.TryGetProperty("session", out var session) && data.TryGetProperty("muted", out var muted))
            {
                SetLocalMute(session.GetUInt32(), muted.GetBoolean());
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.setComment", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected } || LocalUser is null)
                return Task.CompletedTask;

            var comment = data.TryGetProperty("comment", out var c) ? c.GetString() ?? "" : "";
            LocalUser.Comment = comment;
            Connection.SendControl(PacketType.UserState, new UserState
            {
                Session = LocalUser.Id,
                Comment = comment
            });
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.addChannel", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected })
            {
                _bridge?.Send("voice.error", new { message = "Not connected to server", type = "notConnected" });
                return Task.CompletedTask;
            }

            var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
            if (string.IsNullOrWhiteSpace(name))
            {
                _bridge?.Send("voice.error", new { message = "Channel name is required", type = "invalidRequest" });
                return Task.CompletedTask;
            }

            var description = data.TryGetProperty("description", out var d) ? d.GetString() : null;
            if (!string.IsNullOrEmpty(description))
            {
                var utf8Length = System.Text.Encoding.UTF8.GetByteCount(description);
                if (utf8Length >= 128)
                {
                    _bridge?.Send("voice.error", new { message = "Channel description exceeds 127 bytes (UTF-8)", type = "invalidRequest" });
                    return Task.CompletedTask;
                }
            }
            var parent = data.TryGetProperty("parent", out var p) ? p.GetUInt32() : 0u;

            Connection.SendControl(PacketType.ChannelState, new MumbleProto.ChannelState
            {
                Parent = parent,
                Name = name,
                Description = description,
            });

            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.editChannel", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected })
            {
                _bridge?.Send("voice.error", new { message = "Not connected to server", type = "notConnected" });
                return Task.CompletedTask;
            }

            var channelId = data.TryGetProperty("channelId", out var cid) ? cid.GetUInt32() : 0u;
            if (channelId == 0)
            {
                _bridge?.Send("voice.error", new { message = "Invalid channel ID", type = "invalidChannel" });
                return Task.CompletedTask;
            }

            var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
            var description = data.TryGetProperty("description", out var d) ? d.GetString() : null;

            if (string.IsNullOrWhiteSpace(name))
            {
                _bridge?.Send("voice.error", new { message = "Channel name is required", type = "invalidName" });
                return Task.CompletedTask;
            }

            var channel = Channels.FirstOrDefault(c => c.Id == channelId);
            if (channel == null)
            {
                _bridge?.Send("voice.error", new { message = "Channel not found", type = "channelNotFound" });
                return Task.CompletedTask;
            }

            Connection.SendControl(PacketType.ChannelState, new ChannelState
            {
                ChannelId = channelId,
                Name = name,
                Description = description ?? string.Empty,
            });

            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.removeChannel", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected })
            {
                _bridge?.Send("voice.error", new { message = "Not connected to server", type = "notConnected" });
                return Task.CompletedTask;
            }

            var channelId = data.TryGetProperty("channelId", out var cid) ? cid.GetUInt32() : 0u;
            if (channelId == 0)
            {
                _bridge?.Send("voice.error", new { message = "Invalid channel ID", type = "invalidChannel" });
                return Task.CompletedTask;
            }

            Connection.SendControl(PacketType.ChannelRemove, new ChannelRemove
            {
                ChannelId = channelId,
            });

            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.getBans", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected })
            {
                _bridge?.Send("voice.error", new { message = "Not connected", type = "notConnected" });
                return Task.CompletedTask;
            }

            try
            {
                Volatile.Write(ref _pendingBanQuery, 1);
                SendBanList(new BanList { Query = true });
            }
            catch (Exception ex)
            {
                _bridge?.Send("voice.error", new { message = $"Failed to get bans: {ex.Message}", type = "getBansFailed" });
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.unban", data =>
        {
            if (Connection is not { State: ConnectionStates.Connected })
            {
                _bridge?.Send("voice.error", new { message = "Not connected", type = "notConnected" });
                return Task.CompletedTask;
            }

            if (!data.TryGetProperty("index", out var indexElement))
            {
                _bridge?.Send("voice.error", new { message = "Missing ban index", type = "invalidRequest" });
                return Task.CompletedTask;
            }

            var index = indexElement.GetInt32();

            BanList? cachedCopy;
            lock (_banListLock)
            {
                if (_cachedBanList is null || index < 0 || index >= _cachedBanList.Bans.Count)
                {
                    _bridge?.Send("voice.error", new { message = "Invalid ban index", type = "invalidIndex" });
                    return Task.CompletedTask;
                }

                cachedCopy = new BanList
                {
                    Query = false
                };
                cachedCopy.Bans.AddRange(_cachedBanList.Bans);
                cachedCopy.Bans.RemoveAt(index);
                _cachedBanList = cachedCopy;
            }

            try
            {
                SendBanList(cachedCopy);
                _bridge?.Send("voice.unbanned", new { success = true, index });
            }
            catch (Exception ex)
            {
                _bridge?.Send("voice.error", new { message = $"Failed to unban: {ex.Message}", type = "unbanFailed" });
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.getRegisteredUsers", data =>
        {
            _ = GetRegisteredUsersAsync();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("avatar.setSource", async data =>
        {
            if (_apiUrl is null) return;

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null) return;

            try
            {
                var source = data.TryGetProperty("source", out var s) && s.ValueKind != System.Text.Json.JsonValueKind.Null
                    ? s.GetString() : null;
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var uri = new Uri(baseUri, "auth/avatar-source");
                var jsonBody = System.Text.Json.JsonSerializer.Serialize(new { source });
                var result = await PostViaBcTls(cert, uri, jsonBody);
                if (!result.Success)
                    LogToFile($"[Avatar] avatar-source update failed: {result.Error}");
            }
            catch (Exception ex)
            {
                LogToFile($"[Avatar] Failed to update avatar-source: {ex.Message}");
            }
        });

        bridge.RegisterHandler("voice.setCompanion", async payload =>
        {
            var requestId = payload.TryGetProperty("requestId", out var requestIdProp) && requestIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
                ? requestIdProp.GetInt32()
                : (int?)null;
            
            var companionId = payload.TryGetProperty("companionId", out var prop) ? prop.GetString() : null;
            if (string.IsNullOrWhiteSpace(companionId))
            {
                var errorResponse = new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Missing companion ID", requestId };
                _bridge?.Send("voice.setCompanionResponse", errorResponse);
                _bridge?.NotifyUiThread();
                return;
            }

            var result = await SyncCompanionAsync(companionId);
            // Merge requestId into result
            var resultDict = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(
                System.Text.Json.JsonSerializer.Serialize(result)) ?? new Dictionary<string, object>();
            if (requestId.HasValue)
                resultDict["requestId"] = requestId.Value;
            _bridge?.Send("voice.setCompanionResponse", resultDict);
            _bridge?.NotifyUiThread();
        });

        bridge.RegisterHandler("livekit.requestToken", async data =>
        {
            var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
            var requestId = data.TryGetProperty("requestId", out var requestIdProp) && requestIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
                ? requestIdProp.GetInt32()
                : (int?)null;
            if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
            {
                _bridge?.Send("livekit.tokenError", new { error = "Not connected or missing roomName", requestId });
                _bridge?.NotifyUiThread();
                return;
            }

            if (!TryGetLiveKitAccessMode(data, out var accessMode))
            {
                _bridge?.Send("livekit.tokenError", new { error = "Missing or invalid accessMode", requestId });
                _bridge?.NotifyUiThread();
                return;
            }

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null)
            {
                _bridge?.Send("livekit.tokenError", new { error = "No client certificate", requestId });
                _bridge?.NotifyUiThread();
                return;
            }

            var baseUri = new Uri(_apiUrl, UriKind.Absolute);
            var tokenUri = new Uri(baseUri, "livekit/token");
            string jsonBody;
            try
            {
                jsonBody = CreateLiveKitTokenRequestBody(roomName, accessMode);
            }
            catch (ArgumentOutOfRangeException)
            {
                _bridge?.Send("livekit.tokenError", new { error = "accessMode must be 'publish' or 'subscribe'", requestId });
                _bridge?.NotifyUiThread();
                return;
            }

            var delays = new[] { 500, 1000, 2000 };
            TlsResult? lastResult = null;

            for (var attempt = 0; attempt <= delays.Length; attempt++)
            {
                try
                {
                    lastResult = await PostViaBcTls(cert, tokenUri, jsonBody);

                    if (lastResult.Success && lastResult.Body is not null)
                    {
                        // Parse JSON body into dictionary for bridge
                        using var doc = System.Text.Json.JsonDocument.Parse(lastResult.Body);
                        var dict = new Dictionary<string, object?>();
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            dict[prop.Name] = prop.Value.ValueKind switch
                            {
                                System.Text.Json.JsonValueKind.String => prop.Value.GetString(),
                                System.Text.Json.JsonValueKind.Number => prop.Value.GetDouble(),
                                System.Text.Json.JsonValueKind.True => true,
                                System.Text.Json.JsonValueKind.False => false,
                                _ => prop.Value.GetRawText()
                            };
                        }
                        dict["requestId"] = requestId;
                        SendBrmbleServiceStatus("screenshare", "connected");
                        _bridge?.Send("livekit.token", dict);
                        _bridge?.NotifyUiThread();
                        return;
                    }

                    // Don't retry on 4xx — these are client errors that won't self-resolve
                    if (lastResult.StatusCode >= 400 && lastResult.StatusCode < 500)
                        break;
                }
                catch (Exception ex)
                {
                    lastResult = new TlsResult(false, null, 0, ex.Message);
                }

                // Retry after delay if we have attempts remaining
                if (attempt < delays.Length)
                {
                    LogToFile($"[LiveKit] Token request attempt {attempt + 1} failed: {lastResult?.Error ?? "unknown"}, retrying in {delays[attempt]}ms");
                    await Task.Delay(delays[attempt]);
                }
            }

            var errorMsg = lastResult?.Error ?? "Token request failed";
            LogToFile($"[LiveKit] Token request failed after all attempts: {errorMsg}");
            SendBrmbleServiceStatus("screenshare", "disconnected", reason: "token-request-failed");
            _bridge?.Send("livekit.tokenError", new { error = errorMsg, requestId });
            _bridge?.NotifyUiThread();
        });

        bridge.RegisterHandler("livekit.shareStarted", async data =>
        {
            var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
            if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null) return;

            try
            {
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var uri = new Uri(baseUri, "livekit/share-started");
                var result = await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
                if (result.Success)
                    SendBrmbleServiceStatus("screenshare", "connected");
                else
                    SendBrmbleServiceStatus("screenshare", "disconnected", reason: "share-started-failed");
                if (!result.Success)
                    LogToFile($"[LiveKit] share-started notification failed: {result.Error}");
            }
            catch (Exception ex)
            {
                SendBrmbleServiceStatus("screenshare", "disconnected", reason: "share-started-exception");
                LogToFile($"[LiveKit] Failed to notify share-started: {ex.Message}");
            }
        });

        bridge.RegisterHandler("livekit.shareStopped", async data =>
        {
            var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
            if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null) return;

            try
            {
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var uri = new Uri(baseUri, "livekit/share-stopped");
                var result = await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
                if (result.Success)
                    SendBrmbleServiceStatus("screenshare", "connected");
                if (!result.Success)
                    LogToFile($"[LiveKit] share-stopped notification failed: {result.Error}");
            }
            catch (Exception ex)
            {
                LogToFile($"[LiveKit] Failed to notify share-stopped: {ex.Message}");
            }
        });

        bridge.RegisterHandler("livekit.checkActiveShare", async data =>
        {
            var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
            var scope = data.TryGetProperty("scope", out var scopeProp) ? scopeProp.GetString() : null;
            var requestId = data.TryGetProperty("requestId", out var requestIdProp) && requestIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
                ? requestIdProp.GetInt32()
                : (int?)null;
            if ((string.IsNullOrWhiteSpace(roomName) && !string.Equals(scope, "all", StringComparison.Ordinal)) || _apiUrl is null)
            {
                _bridge?.Send("livekit.activeShareError", new { roomName, scope, requestId, reason = "client-not-ready" });
                _bridge?.NotifyUiThread();
                return;
            }

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null)
            {
                SendBrmbleServiceStatus("screenshare", "disconnected", reason: "active-share-request-failed");
                _bridge?.Send("livekit.activeShareError", new { roomName, scope, requestId, reason = "missing-certificate" });
                _bridge?.NotifyUiThread();
                return;
            }

            try
            {
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var query = string.Equals(scope, "all", StringComparison.Ordinal)
                    ? "livekit/active-share?scope=all"
                    : $"livekit/active-share?roomName={Uri.EscapeDataString(roomName!)}";
                var uri = new Uri(baseUri, query);
                var result = await GetViaBcTls(cert, uri);
                if (result.Success && result.Body is not null)
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
                    var shares = new System.Collections.Generic.List<object>();
                    if (doc.RootElement.TryGetProperty("shares", out var sharesArr) && sharesArr.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (var s in sharesArr.EnumerateArray())
                        {
                            var sUserName = s.TryGetProperty("userName", out var un) ? un.GetString() : null;
                            var sUserId = s.TryGetProperty("userId", out var uid) && uid.ValueKind == System.Text.Json.JsonValueKind.Number
                                ? uid.GetInt64() : (long?)null;
                            var sRoomName = s.TryGetProperty("roomName", out var srn) ? srn.GetString() : roomName;
                            var sMatrixUserId = s.TryGetProperty("matrixUserId", out var muid) ? muid.GetString() : null;
                            var sSessionId = s.TryGetProperty("sessionId", out var sid) && sid.ValueKind == System.Text.Json.JsonValueKind.Number
                                ? sid.GetInt32() : (int?)null;
                            shares.Add(new { roomName = sRoomName, userName = sUserName, userId = sUserId, matrixUserId = sMatrixUserId, sessionId = sSessionId });
                        }
                    }
                    SendBrmbleServiceStatus("screenshare", "connected");
                    _bridge?.Send("livekit.activeShareResult", new { roomName, scope, requestId, shares });
                }
                else
                {
                    SendBrmbleServiceStatus("screenshare", "disconnected", reason: "active-share-request-failed");
                    _bridge?.Send("livekit.activeShareError", new { roomName, scope, requestId, reason = "request-failed", statusCode = result.StatusCode });
                }
                _bridge?.NotifyUiThread();
            }
            catch (Exception ex)
            {
                SendBrmbleServiceStatus("screenshare", "disconnected", reason: "active-share-exception");
                _bridge?.Send("livekit.activeShareError", new { roomName, scope, requestId, reason = "exception", message = ex.Message });
                _bridge?.NotifyUiThread();
            }
        });

        bridge.RegisterHandler("voice.setNoiseSuppression", data =>
        {
            var levelStr = data.TryGetProperty("level", out var lv) ? lv.GetString() ?? "High" : "High";
            if (!Enum.TryParse<NoiseSuppressionLevel>(levelStr, ignoreCase: true, out var level))
                level = NoiseSuppressionLevel.High;
            _lastNoiseSuppressionLevel = level;
            _audioManager?.SetNoiseSuppression(level);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("dm.getOrCreateRoom", async data =>
        {
            var targetMatrixUserId = data.ValueKind == System.Text.Json.JsonValueKind.Object
                ? (data.TryGetProperty("targetMatrixUserId", out var t) ? t.GetString() : null)
                : null;
            if (string.IsNullOrWhiteSpace(targetMatrixUserId) || _apiUrl is null)
            {
                _bridge?.Send("dm.roomError", new { targetMatrixUserId = targetMatrixUserId ?? "", error = "Not connected or missing targetMatrixUserId" });
                _bridge?.NotifyUiThread();
                return;
            }

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null)
            {
                _bridge?.Send("dm.roomError", new { targetMatrixUserId, error = "No client certificate" });
                _bridge?.NotifyUiThread();
                return;
            }

            try
            {
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var uri = new Uri(baseUri, "dm/room");
                var jsonBody = System.Text.Json.JsonSerializer.Serialize(new { targetMatrixUserId });
                var result = await PostViaBcTls(cert, uri, jsonBody);

                if (result.Success && result.Body is not null)
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
                    var roomId = doc.RootElement.TryGetProperty("roomId", out var r) ? r.GetString() : null;
                    if (roomId is not null)
                    {
                        _bridge?.Send("dm.roomResolved", new { targetMatrixUserId, roomId });
                        _bridge?.NotifyUiThread();
                        return;
                    }
                }

                _bridge?.Send("dm.roomError", new { targetMatrixUserId, error = result.Error ?? "Failed to get DM room" });
                _bridge?.NotifyUiThread();
            }
            catch (Exception ex)
            {
                LogToFile($"[DM] Failed to get/create DM room for {targetMatrixUserId}: {ex.Message}");
                _bridge?.Send("dm.roomError", new { targetMatrixUserId, error = ex.Message });
                _bridge?.NotifyUiThread();
            }
        });

        bridge.RegisterHandler("voice.vadSensitivity", data =>
        {
            var value = data.TryGetProperty("value", out var v) ? v.GetString() : null;
            var level = value switch
            {
                "low" => VadSensitivity.Low,
                "balanced" => VadSensitivity.Balanced,
                "high" => VadSensitivity.High,
                _ => (VadSensitivity?)null,
            };
            if (level is null)
            {
                AudioLog.Write($"[Bridge] Ignored voice.vadSensitivity with invalid value '{value}'");
                return Task.CompletedTask;
            }
            _audioManager?.SetVadSensitivity(level.Value);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.vadMeterSubscribe", data =>
        {
            var enabled = data.TryGetProperty("enabled", out var e) && e.GetBoolean();
            _audioManager?.SetVadMeterSubscribed(enabled);
            return Task.CompletedTask;
        });
    }

    public void SetUserVolume(uint session, int volume)
    {
        _audioManager?.SetUserVolume(session, volume);
    }

    public void SetLocalMute(uint session, bool muted)
    {
        _audioManager?.SetLocalMute(session, muted);
    }

    public override X509Certificate SelectCertificate(
        object sender,
        string targetHost,
        X509CertificateCollection localCertificates,
        X509Certificate remoteCertificate,
        string[] acceptableIssuers)
    {
        // Return exportable cert so BouncyCastle TlsClientProtocol can extract
        // private key parameters for mTLS signing during TLS handshake.
        return _certService?.GetExportableCertificate()
            ?? base.SelectCertificate(sender, targetHost, localCertificates, remoteCertificate, acceptableIssuers);
    }

    // --- MumbleSharp protocol overrides ---

    public override void ServerSync(ServerSync serverSync)
    {
        base.ServerSync(serverSync);

        // Update _reconnectUsername to the Mumble-confirmed name so that
        // credential fetch and future reconnects use the registered name
        // instead of whatever the user originally typed.
        if (LocalUser?.Name != null)
            _reconnectUsername = LocalUser.Name;

        if (_activeServerId is not null)
        {
            _appConfigService?.SaveLastConnectedServerId(_activeServerId);
        }

        if (!string.IsNullOrEmpty(serverSync.WelcomeText))
        {
            _lastWelcomeText = serverSync.WelcomeText;
            SendSystemMessage(serverSync.WelcomeText, "welcome", html: true);
        }

        // Reuse or recreated AudioManager (see Connect())
        // Set up audio packet handlers (need Connection which is now available)
        _audioManager?.SendVoicePacket += packet =>
            Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
        _audioManager?.UserStartedSpeaking += userId =>
        {
            _bridge?.Send("voice.userSpeaking", new { session = userId });
            // Local user spoke → reset Brmble-app idle timer (synthetic activity ping).
            // Throttled so we don't spam the bridge during normal continuous speech.
            // AudioManager events may fire from multiple threads; use Interlocked on
            // a TickCount64 timestamp instead of a non-atomic Stopwatch.Restart().
            if (LocalUser != null && userId == LocalUser.Id)
            {
                var now = Environment.TickCount64;
                var last = Interlocked.Read(ref _lastLocalTransmitNotifyTicks);
                if (now - last >= LOCAL_TRANSMIT_NOTIFY_THROTTLE_MS
                    && Interlocked.CompareExchange(ref _lastLocalTransmitNotifyTicks, now, last) == last)
                {
                    _bridge?.Send("voice.localTransmit", new { });
                    _bridge?.NotifyUiThread();
                }
            }
        };
        _audioManager?.UserStoppedSpeaking += userId =>
            _bridge?.Send("voice.userSilent", new { session = userId });
        if (LocalUser != null)
            _audioManager?.SetLocalUserId(LocalUser.Id);
        // Don't unconditionally StartMic here — the transmission mode owns
        // mic lifecycle. For PushToTalk it must stay stopped until the key
        // is pressed; for Continuous/VAD/PushToTalkPlus, SetTransmissionMode
        // (driven by ApplySettings on Connect) already starts it.

        StartVoiceIdlePolling();

        // Check which channel the server placed us in.  Unregistered users
        // land in root (channel 0).  Registered users may be placed in their
        // last channel automatically by the Mumble server.
        var initialChannelId = LocalUser?.Channel?.Id ?? 0;
        var rememberLastChannel = _appConfigService?.GetSettings().RememberLastChannel ?? true;

        // Track explicit channel override for voice.connected payload.
        // When we call JoinChannel(0) below, LocalUser.Channel won't update
        // until the server echoes the UserState — so we pass the target
        // channelId explicitly to avoid a race.
        uint? voiceConnectedChannelId = null;

        if (initialChannelId == 0)
        {
            // Root channel — auto-activate leave voice as before.
            // _previousChannelId stays null so the rejoin action is disabled
            // until the user manually joins a channel.
            ActivateLeaveVoice();
        }
        else if (_isReconnect || rememberLastChannel)
        {
            // Reconnect (always keep channel) or setting is on — stay in the
            // non-root channel the server placed us in.
            _leftVoice = false;
            _previousChannelId = null;
            _bridge?.Send("voice.leftVoiceChanged", new { leftVoice = false });
            EmitCanRejoin(false);
        }
        else
        {
            // Fresh connect with "remember last channel" off — move to root
            // and activate leave-voice so the user starts in the lobby.
            JoinChannel(0);
            voiceConnectedChannelId = 0;
            ActivateLeaveVoice(channelMoveInProgress: true);
        }

        _isReconnect = false;

        // Determine the API URL for credential fetch.
        // We fetch credentials BEFORE sending voice.connected so that session
        // mappings are already populated and users appear with their matrixUserId
        // on the very first render (no flash of wrong fallback icon).
        string? credentialUrl = null;

        // Flow A: discover Brmble API URL from welcome text (restricted to matching host)
        if (_apiUrl is null && serverSync.WelcomeText is not null)
        {
            var discovered = ParseBrmbleApiUrl(serverSync.WelcomeText);
            if (discovered is not null
                && Uri.TryCreate(discovered, UriKind.Absolute, out var discoveredUri)
                && string.Equals(discoveredUri.Host, _reconnectHost, StringComparison.OrdinalIgnoreCase))
            {
                _apiUrl = discovered;
                OnApiUrlDiscovered?.Invoke(discovered);
                credentialUrl = discovered;
            }
            else if (discovered is not null)
            {
                Debug.WriteLine($"[Matrix] API URL host mismatch: {discovered} vs {_reconnectHost}");
            }
        }
        // Flow B: _apiUrl already set from /server-info call or voice.connect apiUrl field
        else if (_apiUrl is not null)
        {
            credentialUrl = _apiUrl;
        }

        if (credentialUrl is not null)
        {
            var url = credentialUrl;
            Task.Run(async () =>
            {
                await FetchAndSendCredentials(url);
                SendVoiceConnected(voiceConnectedChannelId);
            });
        }
        else
        {
            // No API URL — credentials fetch not possible; send voice.connected immediately
            SendVoiceConnected(voiceConnectedChannelId);
        }
    }

    /// <summary>
    /// Build the channel/user snapshot and send voice.connected to the frontend.
    /// Called after credential fetch (if available) so session mappings are populated.
    /// </summary>
    /// <param name="overrideChannelId">
    /// When non-null, use this channel ID in the payload instead of reading
    /// <c>LocalUser.Channel.Id</c>.  This avoids a race when the server hasn't
    /// echoed a channel move yet (e.g. fresh connect moving to root).
    /// </param>
    private void SendVoiceConnected(uint? overrideChannelId = null)
    {
        var channelId = overrideChannelId ?? (uint)(LocalUser?.Channel?.Id ?? 0);
        var channels = Channels.Select(c => new { id = c.Id, name = c.Name, parent = c.Parent }).ToList();
        var users = Users.Select(u =>
        {
            var hasMap = _sessionMappings.TryGetValue(u.Id, out var sm);
            return new
            {
                session = u.Id,
                name = u.Name,
                channelId = u.Channel?.Id ?? 0,
                muted = u.Muted || u.SelfMuted || u.Deaf || u.SelfDeaf,
                deafened = u.Deaf || u.SelfDeaf,
                self = u == LocalUser,
                comment = u.Comment,
                certHash = u.CertificateHash,
                matrixUserId = hasMap ? sm!.MatrixUserId : _userMappings.GetValueOrDefault(u.Name),
                companionId = hasMap ? sm!.CompanionId : null,
                isBrmbleClient = hasMap && sm!.IsBrmbleClient
            };
        }).ToList();

        _bridge?.Send("voice.connected", new
        {
            username = LocalUser?.Name,
            channelId,
            channels,
            users,
            registered = LocalUser?.IsRegistered ?? false,
            registeredName = LocalUser?.IsRegistered == true ? LocalUser.Name : (string?)null
        });

        // Voice lifecycle transition: force-release any held input so PTT
        // cannot remain latched across a reconnect (#538).
        _inputRouter?.ReleaseAllHeld();

        Debug.WriteLine($"[Mumble] Sent {channels.Count} channels and {users.Count} users");
    }

    /// <summary>
    /// Called when the server sends updated configuration.
    /// </summary>
    /// <param name="serverConfig">The server config message.</param>
    public override void ServerConfig(MumbleProto.ServerConfig serverConfig)
    {
        base.ServerConfig(serverConfig);

        if (serverConfig.ShouldSerializeWelcomeText() 
            && !string.IsNullOrEmpty(serverConfig.WelcomeText) 
            && serverConfig.WelcomeText != _lastWelcomeText)
        {
            _lastWelcomeText = serverConfig.WelcomeText;
            SendSystemMessage(serverConfig.WelcomeText, "welcome", html: true);
        }
    }

    /// <summary>
    /// Called when a user's state changes.
    /// </summary>
    /// <param name="userState">The user state update from the server.</param>
    public override void UserState(UserState userState)
    {
        var previousChannel = LocalUser?.Channel?.Id;
        var isNewUser = !UserDictionary.ContainsKey(userState.Session);

        // Track previous channel for all users to detect when they leave our channel
        uint? previousUserChannel = null;
        bool wasRegistered = false;
        if (UserDictionary.TryGetValue(userState.Session, out var existingUser))
        {
            previousUserChannel = existingUser.Channel?.Id;
            wasRegistered = existingUser.IsRegistered;
        }

        base.UserState(userState);

        UserDictionary.TryGetValue(userState.Session, out var user);

        // Request full comment if only hash was received
        if (userState.ShouldSerializeCommentHash() && !userState.ShouldSerializeComment())
        {
            SendRequestBlob(new RequestBlob { SessionComments = new[] { userState.Session } });
        }

        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        var currentChannelId = user?.Channel?.Id ?? userState.ChannelId;

        // Detect registration change for local user (e.g. after auto-registration)
        if (isSelf && !wasRegistered && user != null && user.IsRegistered && _activeServerId != null)
        {
            Debug.WriteLine($"[Mumble] Local user became registered: {user.Name} (userId: {user.RegisteredUserId})");
            _bridge?.Send("voice.registrationStatus", new
            {
                serverId = _activeServerId,
                registered = true,
                registeredName = user.Name
            });
        }

        // Check if a user left our channel (moved from our channel to a different one)
        if (!isSelf && previousUserChannel.HasValue && previousChannel.HasValue && 
            previousUserChannel == previousChannel && currentChannelId != previousChannel)
        {
            var leftUserName = user?.Name ?? userState.Name;
            _bridge?.Send("voice.userLeft", new { 
                session = userState.Session, 
                name = leftUserName, 
                channelId = previousUserChannel,
                previousChannelId = previousUserChannel,
                currentChannelId = currentChannelId,
                certHash = user?.CertificateHash,
                moved = true
            });
            Debug.WriteLine($"[Mumble] User left our channel: {leftUserName} (session: {userState.Session})");
        }

        var joinedUserName = user?.Name ?? userState.Name;
        var hasJoinMapping = _sessionMappings.TryGetValue(userState.Session, out var joinMapping);
        _bridge?.Send("voice.userJoined", new
        {
            session = userState.Session,
            name = joinedUserName,
            channelId = currentChannelId,
            muted = user != null ? (user.Muted || user.SelfMuted || user.Deaf || user.SelfDeaf) : (userState.Mute || userState.SelfMute || userState.Deaf || userState.SelfDeaf),
            deafened = user != null ? (user.Deaf || user.SelfDeaf) : (userState.Deaf || userState.SelfDeaf),
            self = isSelf,
            comment = user?.Comment,
            certHash = user?.CertificateHash,
            matrixUserId = hasJoinMapping ? joinMapping!.MatrixUserId : _userMappings.GetValueOrDefault(joinedUserName),
            companionId = hasJoinMapping ? joinMapping!.CompanionId : null,
            isBrmbleClient = hasJoinMapping && joinMapping!.IsBrmbleClient
        });
        _bridge?.NotifyUiThread();

        // Emit system message for genuinely new users (not initial sync, not self)
        if (isNewUser && !isSelf && ReceivedServerSync)
        {
            var userName = userState.Name ?? "Unknown";
            SendSystemMessage($"{userName} connected to the server", "userJoined");
        }

        if (previousChannel.HasValue && currentChannelId != previousChannel && isSelf)
        {
            uint? actorSession = null;
            string? actorName = null;
            var movedByOtherUser = false;
            if (userState.ShouldSerializeActor() && userState.Actor != userState.Session)
            {
                actorSession = userState.Actor;
                movedByOtherUser = true;
                if (UserDictionary.TryGetValue(userState.Actor, out var actor))
                    actorName = actor.Name;
            }

            var isExpectedLocalJoin = _pendingLocalJoinChannelId == currentChannelId;
            if (!movedByOtherUser && !isExpectedLocalJoin && !_leaveVoiceInProgress)
            {
                movedByOtherUser = true;
            }

            _bridge?.Send("voice.channelChanged", CreateChannelChangedPayload(
                previousChannel,
                currentChannelId,
                actorSession,
                actorName,
                movedByOtherUser));

            // Voice lifecycle: force-release held input on every channel
            // transition (#538). Safe to call when nothing is held.
            _inputRouter?.ReleaseAllHeld();

            // If this channel change was initiated by LeaveVoice toggle, just clear the flag
            if (_leaveVoiceInProgress)
            {
                _leaveVoiceInProgress = false;
                if (_pendingLocalJoinChannelId == currentChannelId)
                    _pendingLocalJoinChannelId = null;
            }
            else if (_pendingLocalJoinChannelId == currentChannelId)
            {
                _pendingLocalJoinChannelId = null;
                if (_leftVoice && LocalUser != null)
                {
                    ClearLeaveVoiceState();
                }
            }
            // If user manually joins a channel while in left-voice mode, clear it
            else if (_leftVoice && LocalUser != null)
            {
                ClearLeaveVoiceState();
            }
            // If the user moves to root while not in leave-voice, treat it as activating leave-voice.
            // Store the channel they came from so they can rejoin.
            // ReceivedServerSync guard prevents firing during the initial state-sync burst on connect.
            // ShouldSerializeChannelId guard prevents mute/deafen echoes (which have ChannelId=0 by
            // protobuf default but no explicit channel field) from being mistaken for a move to root.
            else if (currentChannelId == 0 && ReceivedServerSync && userState.ShouldSerializeChannelId())
            {
                _previousChannelId = previousChannel;
                ActivateLeaveVoice();
            }
        }
    }

    protected override void UserStateCommentChanged(User user, string oldComment)
    {
        base.UserStateCommentChanged(user, oldComment);
        _bridge?.Send("voice.userCommentChanged", new
        {
            session = user.Id,
            comment = user.Comment
        });
        _bridge?.NotifyUiThread();
    }

    public override void UserStats(UserStats userStats)
    {
        base.UserStats(userStats);
        if (userStats != null
            && userStats.ShouldSerializeSession()
            && userStats.ShouldSerializeIdlesecs()
            && _voiceIdleTracker != null)
        {
            _voiceIdleTracker.UpdateUserStats(userStats.Session, userStats.Idlesecs);
        }
    }

    /// <summary>
    /// Starts the periodic UserStats poll so we can surface peer idle times
    /// (Mumble has no UserState.idlesecs broadcast — pull-only via UserStats).
    /// Idempotent; stops any existing timer first.
    /// </summary>
    private void StartVoiceIdlePolling()
    {
        if (_voiceIdleTracker == null) return;
        StopVoiceIdlePolling();
        _voiceIdlePollOffset = 0;
        // Bump generation so any callback queued from a previous lifetime bails.
        var generation = Interlocked.Increment(ref _voiceIdlePollGeneration);
        _voiceIdlePollTimer = new System.Threading.Timer(
            _ => PollVoiceIdleTick(generation),
            state: null,
            dueTime: VOICE_IDLE_POLL_INTERVAL_MS,
            period: VOICE_IDLE_POLL_INTERVAL_MS);
    }

    private void StopVoiceIdlePolling()
    {
        // Bump generation BEFORE disposing — if a callback is already queued on
        // the threadpool, it will see the stale generation and exit cleanly.
        Interlocked.Increment(ref _voiceIdlePollGeneration);
        _voiceIdlePollTimer?.Dispose();
        _voiceIdlePollTimer = null;
    }

    /// <summary>
    /// Sweeps a batch of currently-known users for fresh UserStats. Stays
    /// under Mumble's leaky-bucket budget by capping batch size to
    /// <see cref="VOICE_IDLE_POLL_BATCH_SIZE"/> per <see cref="VOICE_IDLE_POLL_INTERVAL_MS"/>
    /// and rolling offset for fairness across users.
    /// Non-reentrant: a slow tick won't pile up overlapping callbacks.
    /// </summary>
    private void PollVoiceIdleTick(int generation)
    {
        // Non-reentrant guard. CompareExchange returns the original value;
        // if a tick was already running we bail without ever entering the body.
        if (Interlocked.CompareExchange(ref _voiceIdlePollInProgress, 1, 0) != 0) return;
        try
        {
            // Stale-callback guard: a callback can be queued on the threadpool
            // before Stop disposes the timer; the generation bump invalidates it.
            if (generation != Volatile.Read(ref _voiceIdlePollGeneration)) return;

            var conn = Connection;
            if (conn == null || conn.State != ConnectionStates.Connected) return;

            // Snapshot sessions; ConcurrentDictionary.Values is a live view but
            // ToArray gives us a stable list for the batch.
            var sessions = UserDictionary.Keys.OrderBy(s => s).ToArray();
            if (sessions.Length == 0) return;

            var plan = PollBatchPlanner.Plan(_voiceIdlePollOffset, sessions.Length, VOICE_IDLE_POLL_BATCH_SIZE);
            foreach (var idx in plan.IndicesToPoll)
            {
                SendRequestUserStats(new UserStats { Session = sessions[idx], StatsOnly = true });
            }
            _voiceIdlePollOffset = plan.NewOffset;
        }
        catch (Exception ex)
        {
            try
            {
                System.IO.File.AppendAllText(
                    System.IO.Path.Combine(System.IO.Path.GetTempPath(), "brmble-tls.log"),
                    $"[{DateTime.Now:HH:mm:ss.fff}] PollVoiceIdleTick error: {ex.Message}\n");
            }
            catch { /* logging is best-effort */ }
        }
        finally
        {
            Interlocked.Exchange(ref _voiceIdlePollInProgress, 0);
        }
    }

    public override void UserRemove(UserRemove userRemove)
    {
        // Look up user name before base call removes them from dictionary
        string? userName = null;
        bool isSelf = LocalUser != null && userRemove.Session == LocalUser.Id;
        if (UserDictionary.TryGetValue(userRemove.Session, out var user))
        {
            userName = user.Name;
        }

        base.UserRemove(userRemove);

        Debug.WriteLine($"[Mumble] UserRemove: session {userRemove.Session}, name: {userName}, isSelf: {isSelf}");

        _voiceIdleTracker?.RemoveUser(userRemove.Session);
        _audioManager?.RemoveUser(userRemove.Session);
        var channelId = user?.Channel?.Id;
        var certHash = user?.CertificateHash;
        _bridge?.Send("voice.userLeft", new { session = userRemove.Session, name = userName, channelId, certHash, moved = false });
        _bridge?.NotifyUiThread();

        if (!isSelf && userName != null && userRemove.ShouldSerializeActor() && userRemove.Actor != 0)
        {
            string? actorName = null;
            if (UserDictionary.TryGetValue(userRemove.Actor, out var actorUser))
            {
                actorName = actorUser.Name;
            }

            _bridge?.Send("voice.moderation", new
            {
                kind = userRemove.Ban ? "user-banned" : "user-kicked",
                session = userRemove.Session,
                name = userName,
                channelId,
                actorSession = userRemove.Actor,
                actorName,
                reason = userRemove.Reason,
            });
            _bridge?.NotifyUiThread();
        }

        // Emit system message
        if (isSelf)
        {
            // Self was kicked or banned
            var actorName = "the server";
            if (userRemove.ShouldSerializeActor() && UserDictionary.TryGetValue(userRemove.Actor, out var actor))
            {
                actorName = actor.Name ?? "Unknown";
            }
            var reason = !string.IsNullOrEmpty(userRemove.Reason) ? $": {userRemove.Reason}" : "";
            _intentionalDisconnect = true;
            _serverRemovalDisconnect = true;
            _reconnectCts?.Cancel();
            _reconnectCts = null;
            _reconnectHost = null;
            _reconnectUsername = null;
            _reconnectPassword = null;

            if (userRemove.Ban == true)
            {
                SendSystemMessage($"You were banned by {actorName}{reason}", "banned");
            }
            else
            {
                SendSystemMessage($"You were kicked by {actorName}{reason}", "kicked");
            }

            _bridge?.Send("voice.disconnected", CreateServerRemovalPayload(
                userRemove.Ban == true,
                actorName,
                userRemove.Reason));
            _bridge?.NotifyUiThread();
            Disconnect();
        }
        else if (userName != null)
        {
            SendSystemMessage($"{userName} disconnected from the server", "userLeft");
        }
    }

    public override void ChannelState(ChannelState channelState)
    {
        base.ChannelState(channelState);

        if (ChannelDictionary.TryGetValue(channelState.ChannelId, out var channel))
        {
            _bridge?.Send("voice.channelJoined", new
            {
                id = channel.Id,
                name = channel.Name,
                parent = channel.Parent
            });
        }
    }

    public override void ChannelRemove(ChannelRemove channelRemove)
    {
        var channelId = channelRemove.ChannelId;
        base.ChannelRemove(channelRemove);
        _bridge?.Send("voice.channelRemoved", new { id = channelId });
    }

    public override void TextMessage(TextMessage textMessage)
    {
        base.TextMessage(textMessage);
        UserDictionary.TryGetValue(textMessage.Actor, out var senderUser);
        _bridge?.Send("voice.message", new
        {
            message = textMessage.Message,
            senderSession = textMessage.Actor,
            channelIds = textMessage.ChannelIds ?? Array.Empty<uint>(),
            treeIds = textMessage.TreeIds ?? Array.Empty<uint>(),
            sessions = textMessage.Sessions ?? Array.Empty<uint>(),
            certHash = senderUser?.CertificateHash,
        });
    }

    public override void Reject(Reject reject)
    {
        base.Reject(reject);
        _rejected = true;
        Debug.WriteLine($"[Mumble] Reject callback fired: reason={reject.Reason}, type={reject.Type}, _rejected={_rejected}");
        _bridge?.Send("voice.error", new { message = reject.Reason, type = reject.Type });
        _bridge?.NotifyUiThread();
    }

    public override void PermissionDenied(PermissionDenied permissionDenied)
    {
        base.PermissionDenied(permissionDenied);

        var reason = !string.IsNullOrEmpty(permissionDenied.Reason)
            ? permissionDenied.Reason
            : $"Permission denied: {permissionDenied.Type}";

        _bridge?.Send("voice.error", new { message = reason, type = "permissionDenied" });
        _bridge?.NotifyUiThread();
    }

    public override void PermissionQuery(PermissionQuery permissionQuery)
    {
        base.PermissionQuery(permissionQuery);

        if (permissionQuery.ShouldSerializeChannelId() && permissionQuery.ShouldSerializePermissions())
        {
            _bridge?.Send("voice.permissions", new
            {
                channelId = permissionQuery.ChannelId,
                permissions = permissionQuery.Permissions
            });
        }
    }

    public override void BanList(BanList banList)
    {
        base.BanList(banList);

        bool shouldSendBans;
        lock (_banListLock)
        {
            _cachedBanList = banList;
            if (Volatile.Read(ref _pendingBanQuery) == 0)
            {
                shouldSendBans = false;
            }
            else
            {
                Volatile.Write(ref _pendingBanQuery, 0);
                shouldSendBans = true;
            }
        }

        if (!shouldSendBans)
            return;

        var banListPayload = banList.Bans.Select(b => new
        {
            address = new IPAddress(b.Address).ToString(),
            bits = b.Mask,
            name = b.Name,
            hash = b.Hash,
            reason = b.Reason,
            start = b.Start,
            duration = b.Duration
        }).ToArray();
        _bridge?.Send("voice.bans", banListPayload);
    }

    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // Don't call base — we use our own decode pipeline instead of
        // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
        if (sequence == 0)
        {
            var userName = Users.FirstOrDefault(u => u.Id == userId)?.Name ?? "?";
            AudioLog.Write($"[JB] user={userId} name={userName} first-packet payloadLen={data.Length}");
        }
        _audioManager?.FeedVoice(userId, data, sequence);
    }
}
