using System.Diagnostics;
using System.Security.Cryptography.X509Certificates;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Certificate;

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
    private PttKeyMonitor? _pttMonitor;
    private string? _lastWelcomeText;
    private readonly CertificateService? _certService;
    private uint? _previousChannelId;
    private bool _leftVoice;
    private bool _leaveVoiceInProgress;
    private bool _canRejoin;
    private TransmissionMode _previousMode = TransmissionMode.Continuous;
    private volatile bool _intentionalDisconnect = false;
    private volatile CancellationTokenSource? _reconnectCts;
    private string? _reconnectHost;
    private int _reconnectPort;
    private string? _reconnectUsername;
    private string? _reconnectPassword;
    private string? _currentPttKey;
    private readonly Stopwatch _notifyThrottle = Stopwatch.StartNew();
    private string? _apiUrl;
    private string? _activeServerId;

    public string ServiceName => "mumble";

    /// <summary>Optional callback invoked when a Brmble API URL is discovered from welcome text (Flow A).</summary>
    public Action<string>? OnApiUrlDiscovered { get; set; }

    /// <summary>The ID of the ServerEntry that initiated the current connection, if any.</summary>
    public string? ActiveServerId => _activeServerId;

    public MumbleAdapter(NativeBridge bridge, IntPtr hwnd, CertificateService? certService = null)
    {
        _bridge = bridge;
        _hwnd = hwnd;
        _certService = certService;
        _audioManager = new AudioManager(_hwnd);
        _audioManager.ToggleMuteRequested += ToggleMute;
        _audioManager.ToggleDeafenRequested += ToggleDeaf;
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
            _bridge?.NotifyUiThread();
            return;
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            _bridge?.Send("voice.error", new { message = "Username is required" });
            _bridge?.NotifyUiThread();
            return;
        }

        if (port is <= 0 or > 65535)
        {
            _bridge?.Send("voice.error", new { message = "Port must be between 1 and 65535" });
            _bridge?.NotifyUiThread();
            return;
        }

        _intentionalDisconnect = false;

        // Recreate audio manager if disposed by a previous Disconnect()
        if (_audioManager == null)
        {
            _audioManager = new AudioManager(_hwnd);
            _audioManager.ToggleMuteRequested += ToggleMute;
            _audioManager.ToggleDeafenRequested += ToggleDeaf;
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

        _pttMonitor?.Dispose();
        _pttMonitor = null;

        _audioManager?.Dispose();
        _audioManager = null;

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
                _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
                _bridge?.NotifyUiThread();
            }
        }

        // Loop exited — either intentional (CTS cancelled) or unexpected connection drop.
        if (!_intentionalDisconnect && !ct.IsCancellationRequested && _reconnectHost != null && _reconnectCts == null)
        {
            // Unexpected drop — clean up and start reconnect loop.
            Disconnect();
            Task.Run(() => ReconnectLoop());
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

        LocalUser.SelfMuted = !LocalUser.SelfMuted;
        if (!LocalUser.SelfMuted && LocalUser.SelfDeaf)
            LocalUser.SelfDeaf = false;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetMuted(LocalUser.SelfMuted);

        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        _bridge?.Flush();
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
            _bridge?.Flush();
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
            _bridge?.Flush();
        }
    }

    public void ToggleDeaf()
    {
        if (LocalUser == null) return;

        LocalUser.SelfDeaf = !LocalUser.SelfDeaf;
        LocalUser.SelfMuted = LocalUser.SelfDeaf;
        LocalUser.SendMuteDeaf();
        _audioManager?.SetDeafened(LocalUser.SelfDeaf);
        _audioManager?.SetMuted(LocalUser.SelfMuted);

        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        _bridge?.Flush();
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

        // Manage key-up monitor for PTT release
        _pttMonitor?.Unwatch();
        if (parsed == TransmissionMode.PushToTalk && key != null)
        {
            _pttMonitor ??= new PttKeyMonitor(_ =>
            {
                var am = Volatile.Read(ref _audioManager);
                if (am != null)
                    Task.Run(() => am.HandleHotKey(AudioManager.PttHotkeyId, false));
            });
            var vk = AudioManager.KeyNameToVirtualKey(key);
            if (vk != 0)
                _pttMonitor.Watch(vk);
            else
                System.Diagnostics.Debug.WriteLine($"[MumbleAdapter] Unknown PTT key '{key}', monitor not started.");
        }
    }

    public void ApplySettings(AppSettings settings)
    {
        SetTransmissionMode(settings.Audio.TransmissionMode, settings.Audio.PushToTalkKey);
        _audioManager?.SetShortcut("toggleMute", settings.Shortcuts.ToggleMuteKey);
        _audioManager?.SetShortcut("toggleDeafen", settings.Shortcuts.ToggleDeafenKey);
        _audioManager?.SetShortcut("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
        _audioManager?.SetInputVolume(settings.Audio.InputVolume);
        _audioManager?.SetOutputVolume(settings.Audio.OutputVolume);
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
    }

    /// <summary>
    /// Parses a Brmble API URL from a Mumble server welcome text.
    /// Looks for an HTML comment of the form: &lt;!--brmble:{"apiUrl":"..."}--&gt;
    /// </summary>
    internal static string? ParseBrmbleApiUrl(string? welcomeText)
    {
        if (string.IsNullOrEmpty(welcomeText))
            return null;

        var match = System.Text.RegularExpressions.Regex.Match(
            welcomeText,
            @"<!--brmble:(\{.*?\})-->",
            System.Text.RegularExpressions.RegexOptions.Singleline);

        if (!match.Success)
            return null;

        try
        {
            using var json = System.Text.Json.JsonDocument.Parse(match.Groups[1].Value);
            return json.RootElement.TryGetProperty("apiUrl", out var apiUrl)
                ? apiUrl.GetString()
                : null;
        }
        catch
        {
            return null;
        }
    }

    private async Task FetchAndSendCredentials(string apiUrl)
    {
        var certHash = _certService?.GetCertHash();
        if (certHash is null)
        {
            _bridge?.Send("voice.error", new { message = "No client certificate — cannot fetch Matrix credentials." });
            _bridge?.NotifyUiThread();
            return;
        }

        try
        {
            using var http = new System.Net.Http.HttpClient();
            var body = System.Text.Json.JsonSerializer.Serialize(new { certHash });
            var response = await http.PostAsync(
                $"{apiUrl}/auth/token",
                new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json"));

            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var credentials = doc.RootElement.Clone();

            _bridge?.Send("server.credentials", credentials);
            _bridge?.NotifyUiThread();

            _apiUrl = apiUrl;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Brmble] Failed to fetch credentials from {apiUrl}: {ex.Message}");
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
    }

    public override X509Certificate SelectCertificate(
        object sender,
        string targetHost,
        X509CertificateCollection localCertificates,
        X509Certificate remoteCertificate,
        string[] acceptableIssuers)
    {
        return _certService?.ActiveCertificate
            ?? base.SelectCertificate(sender, targetHost, localCertificates, remoteCertificate, acceptableIssuers);
    }

    // --- MumbleSharp protocol overrides ---

    public override void ServerSync(ServerSync serverSync)
    {
        base.ServerSync(serverSync);

        var channels = Channels.Select(c => new { id = c.Id, name = c.Name, parent = c.Parent }).ToList();
        var users = Users.Select(u => new
        {
            session = u.Id,
            name = u.Name,
            channelId = u.Channel?.Id ?? 0,
            muted = u.Muted || u.SelfMuted,
            deafened = u.Deaf || u.SelfDeaf,
            self = u == LocalUser
        }).ToList();

        _bridge?.Send("voice.connected", new
        {
            username = LocalUser?.Name,
            channels,
            users
        });

        if (!string.IsNullOrEmpty(serverSync.WelcomeText))
        {
            _lastWelcomeText = serverSync.WelcomeText;
            SendSystemMessage(serverSync.WelcomeText, "welcome", html: true);
        }

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
                Task.Run(() => FetchAndSendCredentials(discovered));
            }
        }
        // Flow B: _apiUrl already set from /server-info call or voice.connect apiUrl field
        else if (_apiUrl is not null)
        {
            var url = _apiUrl;
            Task.Run(() => FetchAndSendCredentials(url));
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

        base.UserState(userState);

        UserDictionary.TryGetValue(userState.Session, out var user);

        Debug.WriteLine($"[Mumble] UserState: {user?.Name ?? userState.Name} (session: {userState.Session}), isNew: {isNewUser}");

        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;

        _bridge?.Send("voice.userJoined", new
        {
            session = userState.Session,
            name = user?.Name ?? userState.Name,
            channelId = user?.Channel?.Id ?? userState.ChannelId,
            muted = user != null ? (user.Muted || user.SelfMuted) : (userState.Mute || userState.SelfMute),
            deafened = user != null ? (user.Deaf || user.SelfDeaf) : (userState.Deaf || userState.SelfDeaf),
            self = isSelf
        });

        // Emit system message for genuinely new users (not initial sync, not self)
        if (isNewUser && !isSelf && ReceivedServerSync)
        {
            var userName = userState.Name ?? "Unknown";
            SendSystemMessage($"{userName} connected to the server", "userJoined");
        }

        var currentChannelId = user?.Channel?.Id ?? userState.ChannelId;
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
        _bridge?.Send("voice.userLeft", new { session = userRemove.Session });

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
        _bridge?.Send("voice.error", new { message = reject.Reason, type = reject.Type });
    }

    public override void PermissionDenied(PermissionDenied permissionDenied)
    {
        base.PermissionDenied(permissionDenied);

        var reason = !string.IsNullOrEmpty(permissionDenied.Reason)
            ? permissionDenied.Reason
            : $"Permission denied: {permissionDenied.Type}";

        _bridge?.Send("voice.error", new { message = reason, type = "permissionDenied" });
    }

    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // Don't call base — we use our own decode pipeline instead of
        // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
        _audioManager?.FeedVoice(userId, data, sequence);
    }
}
