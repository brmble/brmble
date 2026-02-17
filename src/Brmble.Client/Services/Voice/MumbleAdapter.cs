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
    private CancellationTokenSource? _cts;
    private Thread? _processThread;
    private AudioManager? _audioManager;

    public string ServiceName => "mumble";

    public MumbleAdapter(NativeBridge bridge)
    {
        _bridge = bridge;
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

    public void SendTextMessage(string message)
    {
        if (Connection is not { State: ConnectionStates.Connected })
            return;

        Connection.SendControl(PacketType.TextMessage, new TextMessage { Message = message });
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
            if (data.TryGetProperty("message", out var msg))
                SendTextMessage(msg.GetString() ?? "");
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

        _audioManager?.Dispose();
        _audioManager = new AudioManager();
        _audioManager.SendVoicePacket += packet =>
            Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
        _audioManager.UserStartedSpeaking += userId =>
            _bridge?.Send("voice.userSpeaking", new { session = userId });
        _audioManager.UserStoppedSpeaking += userId =>
            _bridge?.Send("voice.userSilent", new { session = userId });
        _audioManager.StartMic();
    }

    public override void UserState(UserState userState)
    {
        var previousChannel = LocalUser?.Channel?.Id;
        base.UserState(userState);

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
        base.UserRemove(userRemove);
        _audioManager?.RemoveUser(userRemove.Session);
        _bridge?.Send("voice.userLeft", new { session = userRemove.Session });
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
            senderSession = textMessage.Actor
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
