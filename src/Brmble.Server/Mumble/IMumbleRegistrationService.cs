// src/Brmble.Server/Mumble/IMumbleRegistrationService.cs
namespace Brmble.Server.Mumble;

/// <summary>
/// Wraps Mumble ICE server proxy registration methods.
/// Mumble is the single source of truth for usernames.
/// </summary>
public interface IMumbleRegistrationService
{
    /// <summary>
    /// Check if the connected user (by Mumble session ID) is registered.
    /// Returns (true, userId) if registered, (false, -1) if not.
    /// </summary>
    Task<(bool IsRegistered, int UserId)> GetRegistrationStatusAsync(int sessionId);

    /// <summary>
    /// Get the registered name for a Mumble user ID.
    /// Returns null if not registered or registration has no name.
    /// </summary>
    Task<string?> GetRegisteredNameAsync(int userId);

    /// <summary>
    /// Register a username bound to a certificate hash in Mumble.
    /// Returns the new Mumble user ID on success.
    /// Throws MumbleNameConflictException if the name is already taken.
    /// Throws MumbleRegistrationException for other ICE failures.
    /// </summary>
    Task<int> RegisterUserAsync(string name, string certHash);
}

/// <summary>Thrown when a requested username is already registered in Mumble.</summary>
public class MumbleNameConflictException : Exception
{
    public string RequestedName { get; }
    public MumbleNameConflictException(string name)
        : base($"Username '{name}' is already registered in Mumble.")
    {
        RequestedName = name;
    }
}

/// <summary>Thrown when Mumble ICE is unavailable or returns an unexpected error.</summary>
public class MumbleRegistrationException : Exception
{
    public MumbleRegistrationException(string message, Exception? inner = null)
        : base(message, inner) { }
}
