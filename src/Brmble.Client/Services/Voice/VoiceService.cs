using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Contract for voice communication services (e.g. Mumble).
/// Communicates with the frontend via NativeBridge using voice.* messages.
/// </summary>
public interface VoiceService : IService
{
    void Connect(string host, int port, string username, string password = "");
    void Disconnect();
    void JoinChannel(uint channelId);
    void SendMessage(string message);
    void ToggleMute();
    void ToggleDeaf();
}
