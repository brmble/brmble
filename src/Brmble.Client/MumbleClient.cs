using System.Diagnostics;
using System.Text.Json;
using MumbleSharp;
using MumbleSharp.Audio;
using MumbleSharp.Audio.Codecs;
using MumbleSharp.Model;
using MumbleProto;
using PacketType = MumbleSharp.Packets.PacketType;

namespace Brmble.Client;

internal sealed class MumbleClient : BasicMumbleProtocol
{
    private readonly WebViewBridge _bridge;
    private CancellationTokenSource? _cts;
    private Task? _processTask;

    public MumbleClient(WebViewBridge bridge) : base()
    {
        _bridge = bridge;
    }

    public void Connect(string host, int port, string username, string password = "", string[]? tokens = null)
    {
        if (Connection?.State == ConnectionStates.Connected)
        {
            throw new InvalidOperationException("Already connected");
        }

        if (string.IsNullOrWhiteSpace(host))
        {
            _bridge.Send("mumbleError", new { message = "Server address is required" });
            return;
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            _bridge.Send("mumbleError", new { message = "Username is required" });
            return;
        }

        if (port <= 0 || port > 65535)
        {
            _bridge.Send("mumbleError", new { message = "Port must be between 1 and 65535" });
            return;
        }

        try
        {
            var connection = new MumbleConnection(host, port, this, voiceSupport: true);
            
            _cts = new CancellationTokenSource();
            _processTask = Task.Run(() => ProcessLoop(_cts.Token));

            connection.Connect(username, password, tokens ?? Array.Empty<string>(), "Brmble");
            _bridge.Send("mumbleConnected", new { username, host, port });
            Debug.WriteLine($"[Mumble] Connected to {host}:{port} as {username}");
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
            _bridge.Send("mumbleError", new { message, code = ex.SocketErrorCode.ToString() });
            Debug.WriteLine($"[Mumble] Connection failed: {message}");
            Disconnect();
        }
        catch (Exception ex)
        {
            _bridge.Send("mumbleError", new { message = ex.Message });
            Debug.WriteLine($"[Mumble] Connection failed: {ex.Message}");
            Disconnect();
        }
    }

    public void Disconnect()
    {
        _cts?.Cancel();
        
        if (Connection != null)
        {
            try
            {
                Connection.Close();
            }
            catch { }
        }

        _bridge.Send("mumbleDisconnected", null);
        Debug.WriteLine("[Mumble] Disconnected");
    }

    private async Task ProcessLoop(CancellationToken ct)
    {
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
                Debug.WriteLine($"[Mumble] Process error: {ex.Message}");
            }
        }
    }

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

    public void JoinChannel(uint channelId)
    {
        if (Connection == null || Connection.State != ConnectionStates.Connected)
            return;

        var channel = new ChannelState { ChannelId = channelId };
        Connection.SendControl(PacketType.ChannelState, channel);
    }

    public void RegisterHandlers(WebViewBridge bridge)
    {
        bridge.RegisterHandler("mumbleConnect", async (data) =>
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
        });

        bridge.RegisterHandler("mumbleDisconnect", async _ => Disconnect());

        bridge.RegisterHandler("mumbleSendMessage", async (data) =>
        {
            if (data.TryGetProperty("message", out var message))
            {
                SendTextMessage(message.GetString() ?? "");
            }
        });

        bridge.RegisterHandler("mumbleJoinChannel", async (data) =>
        {
            if (data.TryGetProperty("channelId", out var channelId))
            {
                var id = channelId.GetUInt32();
                JoinChannel(id);
                Debug.WriteLine($"[Mumble] Joining channel: {id}");
            }
        });
    }

    public override void ServerSync(ServerSync serverSync)
    {
        base.ServerSync(serverSync);
        
        Debug.WriteLine($"[Mumble] ServerSync received, sending full state");
        
        _bridge.Send("mumbleServerSync", new 
        { 
            session = serverSync.Session,
            maxBandwidth = serverSync.MaxBandwidth,
            welcomeText = serverSync.WelcomeText
        });

        // Send all channels
        foreach (var channel in Channels)
        {
            _bridge.Send("mumbleChannel", new 
            { 
                id = channel.Id, 
                name = channel.Name,
                parent = channel.Parent
            });
        }

        // Send all users
        foreach (var user in Users)
        {
            _bridge.Send("mumbleUser", new 
            { 
                session = user.Id, 
                name = user.Name,
                channelId = user.Channel?.Id,
                self = user == LocalUser
            });
        }
        
        Debug.WriteLine($"[Mumble] Sent {Channels.Count()} channels and {Users.Count()} users");
    }

    public override void UserState(UserState userState)
    {
        base.UserState(userState);
        
        Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session})");
        
        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        
        _bridge.Send("mumbleUser", new 
        { 
            session = userState.Session, 
            name = userState.Name,
            channelId = userState.ChannelId,
            self = isSelf
        });
    }

    public override void ChannelState(ChannelState channelState)
    {
        base.ChannelState(channelState);
        
        Debug.WriteLine($"[Mumble] ChannelState: {channelState.Name} (id: {channelState.ChannelId})");
        
        _bridge.Send("mumbleChannel", new 
        { 
            id = channelState.ChannelId, 
            name = channelState.Name,
            parent = channelState.Parent
        });
    }

    public override void TextMessage(TextMessage textMessage)
    {
        base.TextMessage(textMessage);
        
        _bridge.Send("mumbleMessage", new 
        { 
            message = textMessage.Message,
            senderSession = textMessage.Actor
        });
    }

    public override void Reject(Reject reject)
    {
        base.Reject(reject);
        
        _bridge.Send("mumbleError", new 
        { 
            message = reject.Reason,
            type = reject.Type
        });
    }
}
