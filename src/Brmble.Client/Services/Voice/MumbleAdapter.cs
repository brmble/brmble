using System.Diagnostics;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;
using Brmble.Client.Bridge;

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

    public string ServiceName => "mumble";

    public MumbleAdapter(NativeBridge bridge, IntPtr hwnd)
    {
        _bridge = bridge;
        _hwnd = hwnd;
    }

    public void Initialize(NativeBridge bridge) { }

    public void Connect(string host, int port, string username, string password = "")
    {
        if (Connection?.State == ConnectionStates.Connected)
            throw new InvalidOperationException("Already connected");

        if (string.IsNullOrWhiteSpace(host))
        {
            _bridge?.Send("voice.error", new { message = "Server address is required" });
            return;
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            _bridge?.Send("voice.error", new { message = "Username is required" });
            return;
        }

        if (port is <= 0 or > 65535)
        {
            _bridge?.Send("voice.error", new { message = "Port must be between 1 and 65535" });
            return;
        }

        try
        {
            SendSystemMessage($"Connecting to {host}:{port}...", "connecting");

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

        _bridge?.Send("voice.disconnected", null);
    }

    private void ProcessLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested
               && Connection is { State: not ConnectionStates.Disconnected })
        {
            try
            {
                if (Connection.Process())
                    Thread.Yield();
                else
                    Thread.Sleep(1);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            }
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

        _audioManager?.SetTransmissionMode(parsed, key, _hwnd);

        // Manage key-up monitor for PTT release
        _pttMonitor?.Unwatch();
        if (parsed == TransmissionMode.PushToTalk && key != null)
        {
            _pttMonitor ??= new PttKeyMonitor(active => _audioManager?.HandleHotKey(1, active));
            var vk = AudioManager.KeyNameToVirtualKey(key);
            if (vk != 0) _pttMonitor.Watch(vk);
        }
    }

    /// <summary>Called from WndProc on WM_HOTKEY.</summary>
    public void HandleHotKey(int id, bool keyDown)
        => _audioManager?.HandleHotKey(id, keyDown);

    public void JoinChannel(uint channelId)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.UserState, new UserState { ChannelId = channelId });
    }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("voice.connect", data =>
        {
            var h = data.TryGetProperty("host", out var host) ? host.GetString() ?? "localhost" : "localhost";
            var p = data.TryGetProperty("port", out var port) ? port.GetInt32() : 64738;
            var u = data.TryGetProperty("username", out var user) ? user.GetString() ?? "User" : "User";
            var pw = data.TryGetProperty("password", out var pass) ? pass.GetString() ?? "" : "";
            Task.Run(() => Connect(h, p, u, pw));
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.disconnect", _ => { Disconnect(); return Task.CompletedTask; });

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

        bridge.RegisterHandler("voice.joinChannel", data =>
        {
            if (data.TryGetProperty("channelId", out var id))
                JoinChannel(id.GetUInt32());
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.toggleMute", _ => { ToggleMute(); return Task.CompletedTask; });
        bridge.RegisterHandler("voice.toggleDeaf", _ => { ToggleDeaf(); return Task.CompletedTask; });

        bridge.RegisterHandler("voice.setTransmissionMode", data =>
        {
            var mode = data.TryGetProperty("mode", out var m) ? m.GetString() ?? "continuous" : "continuous";
            var key  = data.TryGetProperty("key",  out var k) ? k.GetString() : null;
            SetTransmissionMode(mode, key);
            return Task.CompletedTask;
        });
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

        _audioManager?.Dispose();
        _audioManager = new AudioManager();
        _audioManager.SendVoicePacket += packet =>
            Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
        _audioManager.UserStartedSpeaking += userId =>
            _bridge?.Send("voice.userSpeaking", new { session = userId });
        _audioManager.UserStoppedSpeaking += userId =>
            _bridge?.Send("voice.userSilent", new { session = userId });
        _audioManager.StartMic();

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

        Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session}), isNew: {isNewUser}");

        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;

        _bridge?.Send("voice.userJoined", new
        {
            session = userState.Session,
            name = userState.Name,
            channelId = userState.ChannelId,
            muted = userState.Mute || userState.SelfMute,
            deafened = userState.Deaf || userState.SelfDeaf,
            self = isSelf
        });

        // Emit system message for genuinely new users (not initial sync, not self)
        if (isNewUser && !isSelf && ReceivedServerSync)
        {
            var userName = userState.Name ?? "Unknown";
            SendSystemMessage($"{userName} connected to the server", "userJoined");
        }

        if (previousChannel.HasValue && userState.ChannelId != previousChannel && isSelf)
            _bridge?.Send("voice.channelChanged", new { channelId = userState.ChannelId });
    }

    protected override void UserStateChannelChanged(User user, uint oldChannelId)
    {
        base.UserStateChannelChanged(user, oldChannelId);

        if (user == LocalUser && user.Channel != null)
        {
            _bridge?.Send("voice.userJoined", new
            {
                session = user.Id,
                name = user.Name,
                channelId = user.Channel.Id,
                muted = user.Muted || user.SelfMuted,
                deafened = user.Deaf || user.SelfDeaf,
                self = true
            });
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
        _bridge?.Send("voice.channelJoined", new
        {
            id = channelState.ChannelId,
            name = channelState.Name,
            parent = channelState.Parent
        });
    }

    public override void TextMessage(TextMessage textMessage)
    {
        base.TextMessage(textMessage);
        _bridge?.Send("voice.message", new
        {
            message = textMessage.Message,
            senderSession = textMessage.Actor,
            channelIds = textMessage.ChannelIds ?? Array.Empty<uint>()
        });
    }

    public override void Reject(Reject reject)
    {
        base.Reject(reject);
        _bridge?.Send("voice.error", new { message = reject.Reason, type = reject.Type });
    }

    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // Don't call base — we use our own decode pipeline instead of
        // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
        _audioManager?.FeedVoice(userId, data, sequence);
    }
}
