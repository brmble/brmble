using MumbleSharp.Model;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

public interface VoiceService : IService
{
    string ServiceName { get; }
    
    void Initialize(NativeBridge bridge);
    void RegisterHandlers(NativeBridge bridge);
    
    void Connect(string host, int port, string username, string password = "");
    void Disconnect();
    
    void JoinChannel(uint channelId);
    
    void SendMessage(string message);
    
    event Action? Connected;
    event Action? Disconnected;
    event Action<string>? Error;
    event Action<User>? UserJoined;
    event Action<User>? UserLeft;
    event Action<Channel>? ChannelJoined;
    event Action<string>? MessageReceived;
}
