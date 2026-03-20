using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography.X509Certificates;
using Org.BouncyCastle.Tls;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Certificate;
using Brmble.Client.Services.SpeechEnhancement;

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
    private string? _lastWelcomeText;
    private readonly CertificateService? _certService;
    private uint? _previousChannelId;
    private bool _leftVoice;
    private bool _leaveVoiceInProgress;
    private bool _canRejoin;
    private TransmissionMode _previousMode = TransmissionMode.Continuous;
    private volatile bool _intentionalDisconnect = false;
    private volatile bool _rejected = false;
    private volatile CancellationTokenSource? _reconnectCts;
    private string? _reconnectHost;
    private int _reconnectPort;
    private string? _reconnectUsername;
    private string? _reconnectPassword;
    private string? _currentPttKey;
    private readonly Stopwatch _notifyThrottle = Stopwatch.StartNew();
    private string? _apiUrl;
    private string? _activeServerId;
    private Dictionary<string, string> _userMappings = new();
    private readonly ConcurrentDictionary<uint, SessionMappingEntry> _sessionMappings = new();
    private CancellationTokenSource? _wsCts;
    private readonly IAppConfigService? _appConfigService;
    private System.Threading.Timer? _healthTimer;
    private static readonly HttpClient _healthHttpClient = new(new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
    })
    { Timeout = TimeSpan.FromSeconds(5) };

    private record SessionMappingEntry(string MatrixUserId, string MumbleName);

    public string ServiceName => "mumble";

    /// <summary>Optional callback invoked when a Brmble API URL is discovered from welcome text (Flow A).</summary>
    public Action<string>? OnApiUrlDiscovered { get; set; }

    /// <summary>The ID of the ServerEntry that initiated the current connection, if any.</summary>
    public string? ActiveServerId => _activeServerId;

    public MumbleAdapter(NativeBridge bridge, IntPtr hwnd, CertificateService? certService = null, IAppConfigService? appConfigService = null)
    {
        _bridge = bridge;
        _hwnd = hwnd;
        _certService = certService;
        _appConfigService = appConfigService;
        _audioManager = new AudioManager(_hwnd);
        _audioManager.ToggleMuteRequested += ToggleMute;
        _audioManager.ToggleDeafenRequested += ToggleDeaf;
        _audioManager.ToggleLeaveVoiceRequested += LeaveVoice;
        _audioManager.ToggleDmScreenRequested += () => {
            _bridge?.Send("voice.toggleDmScreen", null);
            _bridge?.NotifyUiThread();
        };
        _audioManager.ToggleScreenShareRequested += () => {
            _bridge?.Send("voice.toggleScreenShare", null);
            _bridge?.NotifyUiThread();
        };
        _audioManager.ShortcutPressed += action => {
            _bridge?.Send("voice.shortcutPressed", new { action });
            _bridge?.NotifyUiThread();
            if (action == "toggleGame")
            {
                _bridge?.Send("game.toggle", null);
                _bridge?.NotifyUiThread();
            }
        };
        _audioManager.ShortcutReleased += action => {
            _bridge?.Send("voice.shortcutReleased", new { action });
            _bridge?.NotifyUiThread();
        };
        _audioManager.ToggleContinuousRequested += () => {
            if (_audioManager == null) return;
            var current = _audioManager.TransmissionMode;
            var newMode = current == TransmissionMode.Continuous ? _previousMode : TransmissionMode.Continuous;
            if (current != TransmissionMode.Continuous)
                _previousMode = current;
            var pttKey = newMode == TransmissionMode.PushToTalk ? _currentPttKey : null;
            _audioManager.SetTransmissionMode(newMode, pttKey, _hwnd);
        };
    }

    public void Initialize(NativeBridge bridge) { }

    public void Connect(string host, int port, string username, string password = "", string? apiUrl = null)
    {
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
            _audioManager = new AudioManager(_hwnd);
            _audioManager.ToggleMuteRequested += ToggleMute;
            _audioManager.ToggleDeafenRequested += ToggleDeaf;
            _audioManager.ToggleLeaveVoiceRequested += LeaveVoice;
            _audioManager.ToggleDmScreenRequested += () => {
                _bridge?.Send("voice.toggleDmScreen", null);
                _bridge?.NotifyUiThread();
            };
            _audioManager.ToggleScreenShareRequested += () => {
                _bridge?.Send("voice.toggleScreenShare", null);
                _bridge?.NotifyUiThread();
            };
            _audioManager.ShortcutPressed += action => {
                _bridge?.Send("voice.shortcutPressed", new { action });
                _bridge?.NotifyUiThread();
            };
            _audioManager.ShortcutReleased += action => {
                _bridge?.Send("voice.shortcutReleased", new { action });
                _bridge?.NotifyUiThread();
            };
            _audioManager.ToggleContinuousRequested += () => {
                if (_audioManager == null) return;
                var current = _audioManager.TransmissionMode;
                var newMode = current == TransmissionMode.Continuous ? _previousMode : TransmissionMode.Continuous;
                if (current != TransmissionMode.Continuous)
                    _previousMode = current;
                var pttKey = newMode == TransmissionMode.PushToTalk ? _currentPttKey : null;
                _audioManager.SetTransmissionMode(newMode, pttKey, _hwnd);
            };
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
        _cts?.Cancel();
        _processThread?.Join(2000);
        _processThread = null;

        _audioManager?.Dispose();
        _audioManager = null;

        // Reset cached speech-enhancement state so that when a new AudioManager
        // is created on reconnect, ConfigureSpeechEnhancement is always called.
        _lastSpeechEnhancementEnabled = false;
        _lastSpeechEnhancementModel = "";
        _lastSpeechDenoiseMode = SpeechDenoiseMode.Disabled;

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
        StopHealthCheck();
        _sessionMappings.Clear();

        UserDictionary.Clear();
        ChannelDictionary.Clear();
        _lastWelcomeText = null;
        _previousChannelId = null;
        if (_intentionalDisconnect || _reconnectHost == null)
        {
            _apiUrl = null;
            _activeServerId = null;
        }
        _leftVoice = false;
        _leaveVoiceInProgress = false;
        EmitCanRejoin(false);

        // Only emit voice.disconnected for intentional disconnects or when no reconnect is possible.
        // When _intentionalDisconnect is false and we have reconnect params, ReconnectLoop will take over.
        if (_intentionalDisconnect || _reconnectHost == null)
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

    public void SetTransmissionMode(string mode, string? key)
    {
        var parsed = mode switch
        {
            "voiceActivity" => TransmissionMode.VoiceActivity,
            "pushToTalk"    => TransmissionMode.PushToTalk,
            "continuous"    => TransmissionMode.Continuous,
            _ => TransmissionMode.Continuous,
        };
        if (parsed == TransmissionMode.Continuous && mode != "continuous")
            Debug.WriteLine($"[Audio] Unknown transmission mode '{mode}', defaulting to Continuous");

        if (parsed == TransmissionMode.PushToTalk)
            _currentPttKey = key;

        _audioManager?.SetTransmissionMode(parsed, key, _hwnd);
    }

    private bool _lastSpeechEnhancementEnabled = false;
    private string _lastSpeechEnhancementModel = "";
    private SpeechDenoiseMode _lastSpeechDenoiseMode = SpeechDenoiseMode.Disabled;

    public void ApplySettings(AppSettings settings)
    {
        SetTransmissionMode(settings.Audio.TransmissionMode, settings.Audio.PushToTalkKey);
        _audioManager?.SetShortcut("toggleMute", settings.Shortcuts.ToggleMuteKey);
        _audioManager?.SetShortcut("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
        _audioManager?.SetShortcut("toggleLeaveVoice", settings.Shortcuts.ToggleLeaveVoiceKey);
        _audioManager?.SetShortcut("toggleDmScreen", settings.Shortcuts.ToggleDMScreenKey);
        _audioManager?.SetShortcut("toggleScreenShare", settings.Shortcuts.ToggleScreenShareKey);
        _audioManager?.SetShortcut("toggleGame", settings.Shortcuts.ToggleGameKey);
        _audioManager?.SetInputVolume(settings.Audio.InputVolume);
        _audioManager?.SetOutputVolume(settings.Audio.OutputVolume);
        _audioManager?.SetMaxAmplification(settings.Audio.MaxAmplification);
        _audioManager?.SetOpusBitrate(settings.Audio.OpusBitrate);
        _audioManager?.SetOpusFrameMs(settings.Audio.OpusFrameSize);
        _audioManager?.SetCaptureApi(settings.Audio.CaptureApi);

        // Only reinitialise speech enhancement when its settings actually change.
        // ConfigureSpeechEnhancement disposes and recreates the ONNX InferenceSession,
        // which causes a native crash if the mic callback is mid-inference at that moment.
        var seEnabled = settings.SpeechEnhancement.Enabled;
        var seModel = (settings.SpeechEnhancement.Model ?? "").Trim().ToLowerInvariant();
        if (seEnabled != _lastSpeechEnhancementEnabled || seModel != _lastSpeechEnhancementModel)
        {
            _lastSpeechEnhancementEnabled = seEnabled;
            _lastSpeechEnhancementModel = seModel;

            var modelVariant = seModel switch
            {
                "vctk-demand" => GtcrnModelVariant.VctkDemand,
                _ => GtcrnModelVariant.Dns3
            };
            var modelsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "models");
            _audioManager?.ConfigureSpeechEnhancement(modelsPath, seEnabled, modelVariant);
        }

        // Configure RNNoise denoising
        var denoiseMode = settings.SpeechDenoise.Mode;
        if (denoiseMode != _lastSpeechDenoiseMode)
        {
            _lastSpeechDenoiseMode = denoiseMode;
            _audioManager?.ConfigureRnnoise(denoiseMode);
        }
    }

    /// <summary>Called from WndProc on WM_HOTKEY.</summary>
    public void HandleHotKey(int id, bool keyDown)
        => _audioManager?.HandleHotKey(id, keyDown);

    /// <summary>Called from WndProc on WM_INPUT.</summary>
    public void HandleRawInput(IntPtr wParam, IntPtr lParam)
        => _audioManager?.HandleRawInput(wParam, lParam);

    public void JoinChannel(uint channelId)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

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
                foreach (var prop in sessionMappingsElement.EnumerateObject())
                {
                    if (uint.TryParse(prop.Name, out var sid))
                    {
                        var matrixId = prop.Value.TryGetProperty("matrixUserId", out var m) ? m.GetString() : null;
                        var name = prop.Value.TryGetProperty("mumbleName", out var n) ? n.GetString() : null;
                        if (matrixId is not null && name is not null)
                            _sessionMappings[sid] = new SessionMappingEntry(matrixId, name);
                    }
                }
            }

            // The server returns its internal homeserverUrl (e.g. http://localhost:6167).
            // Clients reach Matrix via the YARP proxy on the same Brmble API URL,
            // so rewrite homeserverUrl to the API URL the client connected to.
            var rewritten = RewriteMatrixHomeserverUrl(credentials.Value, apiUrl);
            _bridge?.Send("server.credentials", rewritten);
            _bridge?.NotifyUiThread();
            _apiUrl = apiUrl;

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

    private void StartHealthCheck(string apiUrl)
    {
        StopHealthCheck();
        var url = apiUrl.TrimEnd('/') + "/health";

        // Immediately report connecting, then run first check
        _bridge?.Send("server.healthStatus", new { state = "connecting", label = apiUrl });
        _bridge?.NotifyUiThread();

        _healthTimer = new System.Threading.Timer(async _ =>
        {
            try
            {
                var res = await _healthHttpClient.GetAsync(url);
                if (res.IsSuccessStatusCode)
                    _bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl });
                else
                    _bridge?.Send("server.healthStatus", new { state = "disconnected", error = $"Health check returned {(int)res.StatusCode}" });
            }
            catch (Exception ex)
            {
                _bridge?.Send("server.healthStatus", new { state = "disconnected", error = ex.Message });
            }
            _bridge?.NotifyUiThread();
        }, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    private void StopHealthCheck()
    {
        _healthTimer?.Dispose();
        _healthTimer = null;
    }

    private void StartWebSocketConnection(string apiUrl)
    {
        var old = _wsCts;
        old?.Cancel();
        old?.Dispose();
        _wsCts = new CancellationTokenSource();
        var ct = _wsCts.Token;

        var builder = new UriBuilder(apiUrl);
        builder.Scheme = builder.Scheme == "https" ? "wss" : "ws";
        builder.Path = builder.Path.TrimEnd('/') + "/ws";
        var wsUri = builder.Uri;

        _ = Task.Run(async () =>
        {
            var backoff = TimeSpan.FromSeconds(1);
            var maxBackoff = TimeSpan.FromSeconds(30);

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using var cert = _certService?.GetExportableCertificate();
                    if (cert is null)
                    {
                        Debug.WriteLine("[WS] No client certificate available, retrying...");
                        // Apply backoff delay to avoid hot spinning
                        if (ct.IsCancellationRequested) break;
                        try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { break; }
                        backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
                        continue;
                    }

                    // TODO: ClientWebSocket uses SChannel which may refuse self-signed client certs
                    // on some Windows configurations. If WS auth fails, consider a BouncyCastle-based
                    // WebSocket implementation (similar to FetchCredentialsViaBcTls).
                    using var ws = new ClientWebSocket();
                    ws.Options.RemoteCertificateValidationCallback = (_, _, _, _) => true;
                    ws.Options.ClientCertificates.Add(cert);

                    await ws.ConnectAsync(wsUri, ct);
                    backoff = TimeSpan.FromSeconds(1); // reset on successful connect

                    Debug.WriteLine("[WS] Connected to Brmble WebSocket");

                    // Accumulate frames until EndOfMessage for large messages
                    var buffer = new byte[4096];
                    using var ms = new MemoryStream();
                    while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                    {
                        var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                        if (result.MessageType == WebSocketMessageType.Close)
                            break;

                        ms.Write(buffer, 0, result.Count);
                        if (!result.EndOfMessage)
                            continue;

                        var json = System.Text.Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                        ms.SetLength(0);
                        HandleWebSocketMessage(json);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[WS] Error: {ex.Message}");
                }

                if (ct.IsCancellationRequested) break;

                Debug.WriteLine($"[WS] Reconnecting in {backoff.TotalSeconds}s...");
                try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { break; }
                backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
            }
        }, ct);
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
                        foreach (var prop in mappings.EnumerateObject())
                        {
                            if (uint.TryParse(prop.Name, out var sid))
                            {
                                var matrixId = prop.Value.TryGetProperty("matrixUserId", out var m) ? m.GetString() : null;
                                var name = prop.Value.TryGetProperty("mumbleName", out var n) ? n.GetString() : null;
                                if (matrixId is not null && name is not null)
                                    _sessionMappings[sid] = new SessionMappingEntry(matrixId, name);
                            }
                        }
                    }
                    _bridge?.Send("voice.sessionMappingSnapshot",
                        new { mappings = _sessionMappings.ToDictionary(k => k.Key, k => new { k.Value.MatrixUserId, k.Value.MumbleName }) });
                    _bridge?.NotifyUiThread();
                    break;

                case "userMappingAdded":
                    var addSid = root.TryGetProperty("sessionId", out var sidProp) ? sidProp.GetUInt32() : 0u;
                    var addMatrixId = root.TryGetProperty("matrixUserId", out var matrixProp) ? matrixProp.GetString() : null;
                    var addName = root.TryGetProperty("mumbleName", out var nameProp) ? nameProp.GetString() : null;
                    if (addSid > 0 && addMatrixId is not null && addName is not null)
                    {
                        _sessionMappings[addSid] = new SessionMappingEntry(addMatrixId, addName);
                        _bridge?.Send("voice.userMappingUpdated", new { sessionId = addSid, matrixUserId = addMatrixId, mumbleName = addName, action = "added" });
                        _bridge?.NotifyUiThread();
                    }
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

                case "screenShare.started":
                    var startRoom = root.TryGetProperty("roomName", out var startRoomProp) ? startRoomProp.GetString() : null;
                    var startUser = root.TryGetProperty("userName", out var startUserProp) ? startUserProp.GetString() : null;
                    var startSession = root.TryGetProperty("sessionId", out var startSessionProp) && startSessionProp.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? startSessionProp.GetInt32() : (int?)null;
                    if (startRoom is not null)
                    {
                        _bridge?.Send("livekit.screenShareStarted", new { roomName = startRoom, userName = startUser, sessionId = startSession });
                        _bridge?.NotifyUiThread();
                    }
                    break;

                case "screenShare.stopped":
                    var stopRoom = root.TryGetProperty("roomName", out var stopRoomProp) ? stopRoomProp.GetString() : null;
                    if (stopRoom is not null)
                    {
                        _bridge?.Send("livekit.screenShareStopped", new { roomName = stopRoom });
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
            _audioManager?.SetShortcut(action, key);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.suspendHotkeys", _ =>
        {
            _audioManager?.SuspendHotkeys();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.resumeHotkeys", _ =>
        {
            _audioManager?.ResumeHotkeys();
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.pttKey", data =>
        {
            var pressed = data.TryGetProperty("pressed", out var p) && p.GetBoolean();
            _audioManager?.HandlePttKeyFromJs(pressed);
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

        bridge.RegisterHandler("livekit.requestToken", async data =>
        {
            var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
            if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
            {
                _bridge?.Send("livekit.tokenError", new { error = "Not connected or missing roomName" });
                _bridge?.NotifyUiThread();
                return;
            }

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null)
            {
                _bridge?.Send("livekit.tokenError", new { error = "No client certificate" });
                _bridge?.NotifyUiThread();
                return;
            }

            var baseUri = new Uri(_apiUrl, UriKind.Absolute);
            var tokenUri = new Uri(baseUri, "livekit/token");
            var jsonBody = System.Text.Json.JsonSerializer.Serialize(new { roomName });

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
            _bridge?.Send("livekit.tokenError", new { error = errorMsg });
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
                if (!result.Success)
                    LogToFile($"[LiveKit] share-started notification failed: {result.Error}");
            }
            catch (Exception ex)
            {
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
            if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
            {
                _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
                _bridge?.NotifyUiThread();
                return;
            }

            using var cert = _certService?.GetExportableCertificate();
            if (cert is null)
            {
                _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
                _bridge?.NotifyUiThread();
                return;
            }

            try
            {
                var baseUri = new Uri(_apiUrl, UriKind.Absolute);
                var uri = new Uri(baseUri, $"livekit/active-share?roomName={Uri.EscapeDataString(roomName)}");
                var result = await GetViaBcTls(cert, uri);
                if (result.Success && result.Body is not null)
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
                    var userName = doc.RootElement.TryGetProperty("userName", out var un) ? un.GetString() : null;
                    var activeSessionId = doc.RootElement.TryGetProperty("sessionId", out var asProp) && asProp.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? asProp.GetInt32() : (int?)null;
                    _bridge?.Send("livekit.activeShareResult", new { roomName, active = true, userName, sessionId = activeSessionId });
                }
                else
                {
                    _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
                }
                _bridge?.NotifyUiThread();
            }
            catch
            {
                _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
                _bridge?.NotifyUiThread();
            }
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
            _bridge?.Send("voice.userSpeaking", new { session = userId });
        _audioManager?.UserStoppedSpeaking += userId =>
            _bridge?.Send("voice.userSilent", new { session = userId });
        if (LocalUser != null)
            _audioManager?.SetLocalUserId(LocalUser.Id);
        _audioManager?.StartMic();

        // User starts in root channel on connect — auto-activate leave voice.
        // _previousChannelId stays null so the rejoin action is disabled until
        // the user manually joins a channel.
        ActivateLeaveVoice();

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
                SendVoiceConnected();
            });
        }
        else
        {
            // No API URL — credentials fetch not possible; send voice.connected immediately
            SendVoiceConnected();
        }
    }

    /// <summary>
    /// Build the channel/user snapshot and send voice.connected to the frontend.
    /// Called after credential fetch (if available) so session mappings are populated.
    /// </summary>
    private void SendVoiceConnected()
    {
        var channels = Channels.Select(c => new { id = c.Id, name = c.Name, parent = c.Parent }).ToList();
        var users = Users.Select(u => new
        {
            session = u.Id,
            name = u.Name,
            channelId = u.Channel?.Id ?? 0,
            muted = u.Muted || u.SelfMuted || u.Deaf || u.SelfDeaf,
            deafened = u.Deaf || u.SelfDeaf,
            self = u == LocalUser,
            comment = u.Comment,
            matrixUserId = _sessionMappings.TryGetValue(u.Id, out var sm)
                ? sm.MatrixUserId
                : _userMappings.GetValueOrDefault(u.Name)
        }).ToList();

        _bridge?.Send("voice.connected", new
        {
            username = LocalUser?.Name,
            channels,
            users
        });

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
        if (UserDictionary.TryGetValue(userState.Session, out var existingUser))
        {
            previousUserChannel = existingUser.Channel?.Id;
        }

        base.UserState(userState);

        UserDictionary.TryGetValue(userState.Session, out var user);

        // Request full comment if only hash was received
        if (userState.ShouldSerializeCommentHash() && !userState.ShouldSerializeComment())
        {
            SendRequestBlob(new RequestBlob { SessionComments = new[] { userState.Session } });
        }

        Debug.WriteLine($"[Mumble] UserState: {user?.Name ?? userState.Name} (session: {userState.Session}), isNew: {isNewUser}, prevChannel: {previousUserChannel}");

        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        var currentChannelId = user?.Channel?.Id ?? userState.ChannelId;

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
                moved = true
            });
            Debug.WriteLine($"[Mumble] User left our channel: {leftUserName} (session: {userState.Session})");
        }

        var joinedUserName = user?.Name ?? userState.Name;
        _bridge?.Send("voice.userJoined", new
        {
            session = userState.Session,
            name = joinedUserName,
            channelId = currentChannelId,
            muted = user != null ? (user.Muted || user.SelfMuted || user.Deaf || user.SelfDeaf) : (userState.Mute || userState.SelfMute || userState.Deaf || userState.SelfDeaf),
            deafened = user != null ? (user.Deaf || user.SelfDeaf) : (userState.Deaf || userState.SelfDeaf),
            self = isSelf,
            comment = user?.Comment,
            matrixUserId = _sessionMappings.TryGetValue(userState.Session, out var sm)
                ? sm.MatrixUserId
                : _userMappings.GetValueOrDefault(joinedUserName)
        });

        // Emit system message for genuinely new users (not initial sync, not self)
        if (isNewUser && !isSelf && ReceivedServerSync)
        {
            var userName = userState.Name ?? "Unknown";
            SendSystemMessage($"{userName} connected to the server", "userJoined");
        }

        if (previousChannel.HasValue && currentChannelId != previousChannel && isSelf)
        {
            _bridge?.Send("voice.channelChanged", new { channelId = currentChannelId });

            // If this channel change was initiated by LeaveVoice toggle, just clear the flag
            if (_leaveVoiceInProgress)
            {
                _leaveVoiceInProgress = false;
            }
            // If user manually joins a channel while in left-voice mode, clear it
            else if (_leftVoice && LocalUser != null)
            {
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

        _audioManager?.RemoveUser(userRemove.Session);
        var channelId = user?.Channel?.Id;
        _bridge?.Send("voice.userLeft", new { session = userRemove.Session, name = userName, channelId, moved = false });

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

            if (userRemove.Ban == true)
            {
                SendSystemMessage($"You were banned by {actorName}{reason}", "banned");
            }
            else
            {
                SendSystemMessage($"You were kicked by {actorName}{reason}", "kicked");
            }
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
        _bridge?.Send("voice.message", new
        {
            message = textMessage.Message,
            senderSession = textMessage.Actor,
            channelIds = textMessage.ChannelIds ?? Array.Empty<uint>(),
            sessions = textMessage.Sessions ?? Array.Empty<uint>(),
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

    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // Don't call base — we use our own decode pipeline instead of
        // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
        _audioManager?.FeedVoice(userId, data, sequence);
    }
}
