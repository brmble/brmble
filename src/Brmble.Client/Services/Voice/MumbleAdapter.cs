using System.Diagnostics;
using System.Text.Json;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Mumble protocol adapter implementing the VoiceService interface.
/// </summary>
/// <remarks>
/// This adapter connects to Mumble servers using MumbleSharp and translates between
/// Mumble protocol events and the voice.* message format used by the frontend.
/// </remarks>
internal sealed class MumbleAdapter : BasicMumbleProtocol, VoiceService
{
    private readonly NativeBridge? _bridge;
    private CancellationTokenSource? _cts;
    private Task? _processTask;

    /// <inheritdoc />
    public string ServiceName => "mumble";

    /// <inheritdoc />
    public event Action? Connected;
    
    /// <inheritdoc />
    public event Action? Disconnected;
    
    /// <inheritdoc />
    public event Action<string>? Error;
    
    /// <inheritdoc />
    public event Action<User>? UserJoined;
    
    /// <inheritdoc />
    public event Action<User>? UserLeft;
    
    /// <inheritdoc />
    public event Action<Channel>? ChannelJoined;
    
    /// <inheritdoc />
    public event Action<string>? MessageReceived;

    /// <summary>
    /// Initializes a new instance of the MumbleAdapter class.
    /// </summary>
    /// <param name="bridge">The NativeBridge for communicating with the frontend.</param>
    public MumbleAdapter(NativeBridge bridge)
    {
        _bridge = bridge;
    }

    /// <inheritdoc />
    public void Initialize(NativeBridge bridge)
    {
        // Initialization handled in constructor
    }

    /// <inheritdoc />
    public void Connect(string host, int port, string username, string password = "")
    {
        if (Connection?.State == ConnectionStates.Connected)
        {
            throw new InvalidOperationException("Already connected");
        }

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

        if (port <= 0 || port > 65535)
        {
            _bridge?.Send("voice.error", new { message = "Port must be between 1 and 65535" });
            return;
        }

        try
        {
            var connection = new MumbleConnection(host, port, this, voiceSupport: true);
            
            _cts = new CancellationTokenSource();
            _processTask = Task.Run(() => ProcessLoop(_cts.Token));

            connection.Connect(username, password, Array.Empty<string>(), "Brmble");
            
            Debug.WriteLine($"[Mumble] Connection handshake complete, waiting for server sync...");
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
            Debug.WriteLine($"[Mumble] Socket connection failed: {message}\n{ex}");
            Disconnect();
        }
        catch (Exception ex)
        {
            _bridge?.Send("voice.error", new { message = ex.Message });
            Debug.WriteLine($"[Mumble] Connection failed: {ex}\n{ex.StackTrace}");
            Disconnect();
        }
    }

    /// <inheritdoc />
    public void Disconnect()
    {
        _cts?.Cancel();
        
        if (Connection != null)
        {
            try
            {
                Connection.Close();
            }
            catch
            {
                Debug.WriteLine("[Mumble] Error closing connection");
            }
        }

        _bridge?.Send("voice.disconnected", null);
        Debug.WriteLine("[Mumble] Disconnected");
    }

    /// <summary>
    /// Processes incoming Mumble protocol messages.
    /// </summary>
    /// <param name="ct">The cancellation token for stopping the loop.</param>
    private async Task ProcessLoop(CancellationToken ct)
    {
        Debug.WriteLine("[Mumble] ProcessLoop started");
        while (!ct.IsCancellationRequested && Connection != null)
        {
            try
            {
                if (Connection.State == ConnectionStates.Connected)
                {
                    Connection.Process();
                }
                await Task.Delay(10, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Mumble] Process error: {ex}");
                _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            }
        }
        Debug.WriteLine("[Mumble] ProcessLoop ended");
    }

    /// <inheritdoc />
    public void SendMessage(string message)
    {
        SendTextMessage(message);
    }

    /// <summary>
    /// Sends a text message to the current channel.
    /// </summary>
    /// <param name="message">The message text to send.</param>
    public void SendTextMessage(string message)
    {
        if (Connection == null || Connection.State != ConnectionStates.Connected)
            return;

        var textMessage = new TextMessage
        {
            Message = message
        };

        Connection.SendControl(PacketType.TextMessage, textMessage);
    }

    /// <inheritdoc />
    public void ToggleMute()
    {
        if (LocalUser == null)
            return;

        LocalUser.SelfMuted = !LocalUser.SelfMuted;
        // Unmuting while deafened also undeafens (Mumble behavior)
        if (!LocalUser.SelfMuted && LocalUser.SelfDeaf)
            LocalUser.SelfDeaf = false;
        LocalUser.SendMuteDeaf();

        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        Debug.WriteLine($"[Mumble] SelfMute toggled: {LocalUser.SelfMuted}, SelfDeaf: {LocalUser.SelfDeaf}");
    }

    /// <inheritdoc />
    public void ToggleDeaf()
    {
        if (LocalUser == null)
            return;

        LocalUser.SelfDeaf = !LocalUser.SelfDeaf;
        LocalUser.SelfMuted = LocalUser.SelfDeaf; // deafen implies mute in Mumble
        LocalUser.SendMuteDeaf();

        _bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
        _bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
        Debug.WriteLine($"[Mumble] SelfDeaf toggled: {LocalUser.SelfDeaf}, SelfMute: {LocalUser.SelfMuted}");
    }

    /// <inheritdoc />
    public void JoinChannel(uint channelId)
    {
        if (Connection == null || Connection.State != ConnectionStates.Connected)
            return;

        var userState = new UserState { ChannelId = channelId };
        Connection.SendControl(PacketType.UserState, userState);
        Debug.WriteLine($"[Mumble] Sent join channel request for: {channelId}");
    }

    /// <inheritdoc />
    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("voice.connect", (data) =>
        {
            string p = "localhost";
            int pt = 64738;
            string u = "User";
            string pw = "";

            if (data.TryGetProperty("host", out var host))
                p = host.GetString() ?? "localhost";
            if (data.TryGetProperty("port", out var port))
                pt = port.GetInt32();
            if (data.TryGetProperty("username", out var username))
                u = username.GetString() ?? "User";
            if (data.TryGetProperty("password", out var password))
                pw = password.GetString() ?? "";

            Connect(p, pt, u, pw);
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.disconnect", _ => { Disconnect(); return Task.CompletedTask; });

        bridge.RegisterHandler("voice.sendMessage", (data) =>
        {
            if (data.TryGetProperty("message", out var message))
            {
                SendTextMessage(message.GetString() ?? "");
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.joinChannel", (data) =>
        {
            if (data.TryGetProperty("channelId", out var channelId))
            {
                var id = channelId.GetUInt32();
                JoinChannel(id);
                Debug.WriteLine($"[Mumble] Joining channel: {id}");
            }
            return Task.CompletedTask;
        });

        bridge.RegisterHandler("voice.toggleMute", _ => { ToggleMute(); return Task.CompletedTask; });
        bridge.RegisterHandler("voice.toggleDeaf", _ => { ToggleDeaf(); return Task.CompletedTask; });
    }

    /// <summary>
    /// Called when the server sends synchronization data after authentication.
    /// </summary>
    /// <param name="serverSync">The server sync message containing initial state.</param>
    public override void ServerSync(ServerSync serverSync)
    {
        base.ServerSync(serverSync);
        
        Debug.WriteLine($"[Mumble] ServerSync received, sending full state");
        
        var channelList = Channels.Select(c => new { id = c.Id, name = c.Name, parent = c.Parent }).ToList();
        
        // Send all users - don't filter by channelId in initial sync
        var userList = Users.Select(u => new { 
            session = u.Id, 
            name = u.Name, 
            channelId = u.Channel?.Id ?? 0, 
            muted = u.Muted || u.SelfMuted,
            deafened = u.Deaf || u.SelfDeaf,
            self = u == LocalUser 
        }).ToList();
        
        Debug.WriteLine($"[Mumble] Local user: {LocalUser?.Name}, channel: {LocalUser?.Channel?.Id}");
        
        _bridge?.Send("voice.connected", new { 
            username = LocalUser?.Name,
            channels = channelList,
            users = userList
        });
        
        Debug.WriteLine($"[Mumble] Sent {channelList.Count} channels and {userList.Count} users");
    }

    /// <summary>
    /// Called when a user's state changes.
    /// </summary>
    /// <param name="userState">The user state update from the server.</param>
    public override void UserState(UserState userState)
    {
        var previousChannel = LocalUser?.Channel?.Id;
        
        base.UserState(userState);
        
        Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session})");
        
        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        var newChannel = userState.ChannelId;
        
        // Send userJoined for new users or channel changes
        _bridge?.Send("voice.userJoined", new 
        { 
            session = userState.Session, 
            name = userState.Name,
            channelId = userState.ChannelId,
            muted = userState.Mute || userState.SelfMute,
            deafened = userState.Deaf || userState.SelfDeaf,
            self = isSelf
        });
        
        // If user switched channels, notify
        if (previousChannel.HasValue && newChannel != previousChannel && isSelf)
        {
            _bridge?.Send("voice.channelChanged", new
            {
                channelId = newChannel
            });
        }
    }

    /// <summary>
    /// Called when a user's channel changes.
    /// </summary>
    protected override void UserStateChannelChanged(User user, uint oldChannelId)
    {
        base.UserStateChannelChanged(user, oldChannelId);
        
        if (user == LocalUser && user.Channel != null)
        {
            Debug.WriteLine($"[Mumble] LocalUser channel changed to: {user.Channel.Id}");
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

    /// <summary>
    /// Called when a user is removed from the server.
    /// </summary>
    /// <param name="userRemove">The user removal event from the server.</param>
    public override void UserRemove(UserRemove userRemove)
    {
        base.UserRemove(userRemove);
        
        Debug.WriteLine($"[Mumble] UserRemove: session {userRemove.Session}");
        
        _bridge?.Send("voice.userLeft", new 
        { 
            session = userRemove.Session
        });
    }

    /// <summary>
    /// Called when a channel's state changes.
    /// </summary>
    /// <param name="channelState">The channel state update from the server.</param>
    public override void ChannelState(ChannelState channelState)
    {
        base.ChannelState(channelState);
        
        Debug.WriteLine($"[Mumble] ChannelState: {channelState.Name} (id: {channelState.ChannelId})");
        
        _bridge?.Send("voice.channelJoined", new 
        { 
            id = channelState.ChannelId, 
            name = channelState.Name,
            parent = channelState.Parent
        });
    }

    /// <summary>
    /// Called when a text message is received.
    /// </summary>
    /// <param name="textMessage">The text message from the server.</param>
    public override void TextMessage(TextMessage textMessage)
    {
        base.TextMessage(textMessage);
        
        // Show notification for messages from other users (not our own messages)
        if (textMessage.Actor != LocalUser?.Id)
        {
            TrayIcon.SetNotification(true);
        }
        
        _bridge?.Send("voice.message", new 
        { 
            message = textMessage.Message,
            senderSession = textMessage.Actor
        });
    }

    /// <summary>
    /// Called when the server rejects the connection.
    /// </summary>
    /// <param name="reject">The rejection reason from the server.</param>
    public override void Reject(Reject reject)
    {
        base.Reject(reject);
        
        _bridge?.Send("voice.error", new 
        { 
            message = reject.Reason,
            type = reject.Type
        });
    }
}
