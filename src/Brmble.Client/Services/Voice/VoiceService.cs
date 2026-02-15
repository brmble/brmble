using MumbleSharp.Model;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Defines the contract for voice communication services.
/// </summary>
/// <remarks>
/// Implementations of this interface provide voice communication functionality (e.g., Mumble).
/// The service communicates with the frontend via the NativeBridge using voice.* message types.
/// </remarks>
public interface VoiceService : IService
{
    /// <summary>
    /// Gets the service name identifier.
    /// </summary>
    string ServiceName { get; }
    
    /// <summary>
    /// Initializes the service with the specified bridge.
    /// </summary>
    /// <param name="bridge">The NativeBridge for message passing.</param>
    void Initialize(NativeBridge bridge);
    
    /// <summary>
    /// Registers handlers for voice commands from the frontend.
    /// </summary>
    /// <param name="bridge">The NativeBridge to register handlers with.</param>
    void RegisterHandlers(NativeBridge bridge);
    
    /// <summary>
    /// Connects to a voice server.
    /// </summary>
    /// <param name="host">The server hostname or IP address.</param>
    /// <param name="port">The server port number.</param>
    /// <param name="username">The username to authenticate with.</param>
    /// <param name="password">Optional password for authentication.</param>
    void Connect(string host, int port, string username, string password = "");
    
    /// <summary>
    /// Disconnects from the current voice server.
    /// </summary>
    void Disconnect();
    
    /// <summary>
    /// Joins a voice channel.
    /// </summary>
    /// <param name="channelId">The unique identifier of the channel to join.</param>
    void JoinChannel(uint channelId);
    
    /// <summary>
    /// Sends a text message to the current channel.
    /// </summary>
    /// <param name="message">The message text to send.</param>
    void SendMessage(string message);
    
    /// <summary>
    /// Occurs when successfully connected to a voice server.
    /// </summary>
    event Action? Connected;
    
    /// <summary>
    /// Occurs when disconnected from the voice server.
    /// </summary>
    event Action? Disconnected;
    
    /// <summary>
    /// Occurs when an error occurs in the voice service.
    /// </summary>
    event Action<string>? Error;
    
    /// <summary>
    /// Occurs when a user joins the server or a channel.
    /// </summary>
    event Action<User>? UserJoined;
    
    /// <summary>
    /// Occurs when a user leaves the server or a channel.
    /// </summary>
    event Action<User>? UserLeft;
    
    /// <summary>
    /// Occurs when successfully joined a channel.
    /// </summary>
    event Action<Channel>? ChannelJoined;
    
    /// <summary>
    /// Occurs when a text message is received.
    /// </summary>
    event Action<string>? MessageReceived;
}
