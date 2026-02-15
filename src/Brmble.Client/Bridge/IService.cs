namespace Brmble.Client.Bridge;

/// <summary>
/// Defines the contract for a backend service that can communicate with the frontend via the NativeBridge.
/// </summary>
/// <remarks>
/// Services implement this interface to provide modular backend functionality (e.g., voice, chat, screen sharing).
/// Each service is identified by a unique service name and communicates through message passing.
/// </remarks>
public interface IService
{
    /// <summary>
    /// Gets the unique identifier for this service.
    /// </summary>
    /// <value>
    /// A string identifier (e.g., "voice", "matrix", "livekit").
    /// </value>
    string ServiceName { get; }

    /// <summary>
    /// Initializes the service with the specified bridge.
    /// </summary>
    /// <param name="bridge">The NativeBridge instance for sending/receiving messages.</param>
    void Initialize(NativeBridge bridge);

    /// <summary>
    /// Registers message handlers for receiving commands from the frontend.
    /// </summary>
    /// <param name="bridge">The NativeBridge instance to register handlers with.</param>
    void RegisterHandlers(NativeBridge bridge);
}
