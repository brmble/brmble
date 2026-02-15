using MumbleSharp.Model;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

public abstract class VoiceService : IService
{
    public abstract string ServiceName { get; }
    
    public abstract void Initialize(NativeBridge bridge);
    public abstract void RegisterHandlers(NativeBridge bridge);
    
    public abstract void Connect(string host, int port, string username, string password = "");
    public abstract void Disconnect();
    
    public abstract void JoinChannel(uint channelId);
    
    public abstract void SendMessage(string message);
    
    public event Action? Connected;
    public event Action? Disconnected;
    public event Action<string>? Error;
    public event Action<User>? UserJoined;
    public event Action<User>? UserLeft;
    public event Action<Channel>? ChannelJoined;
    public event Action<string>? MessageReceived;
    
    protected void OnConnected() => Connected?.Invoke();
    protected void OnDisconnected() => Disconnected?.Invoke();
    protected void OnError(string message) => Error?.Invoke(message);
    protected void OnUserJoined(User user) => UserJoined?.Invoke(user);
    protected void OnUserLeft(User user) => UserLeft?.Invoke(user);
    protected void OnChannelJoined(Channel channel) => ChannelJoined?.Invoke(channel);
    protected void OnMessageReceived(string message) => MessageReceived?.Invoke(message);
}
