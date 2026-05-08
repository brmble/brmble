using Brmble.Server.Data;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Auth;

public record AdminUserDto(
    long? Id,
    string DisplayName,
    string? CertHash,
    string? MatrixUserId,
    long IsAdmin,
    bool IsBrmbleUser,
    bool IsMumbleRegistered,
    int? MumbleUserId = null
);

public class AdminService
{
    private readonly UserRepository _userRepo;
    private readonly IMumbleRegistrationService _mumbleService;
    private readonly ILogger<AdminService> _logger;

    public AdminService(
        UserRepository userRepo,
        IMumbleRegistrationService mumbleService,
        ILogger<AdminService> logger)
    {
        _userRepo = userRepo;
        _mumbleService = mumbleService;
        _logger = logger;
    }

    public async Task<List<AdminUserDto>> GetRegisteredUsersAsync()
    {
        // Mumble's registered user list is the authoritative source of truth.
        // Only return what Mumble has registered — this mirrors the Mumble admin UI.
        var mumbleUsers = await _mumbleService.GetRegisteredUsersAsync("");

        var result = new List<AdminUserDto>();

        foreach (var mumbleEntry in mumbleUsers)
        {
            result.Add(new AdminUserDto(
                Id: null,
                DisplayName: mumbleEntry.Value,
                CertHash: null,
                MatrixUserId: null,
                IsAdmin: 0,
                IsBrmbleUser: false,
                IsMumbleRegistered: true,
                MumbleUserId: mumbleEntry.Key
            ));
        }

        return result;
    }

    public async Task<bool> DeleteUserAsync(long userId)
    {
        try
        {
            // Get user info first
            var user = await _userRepo.GetAsync(userId);
            if (user == null)
            {
                _logger.LogWarning("DeleteUser: User with ID {UserId} not found", userId);
                return false;
            }

            // Unregister from Mumble if registered
            var mumbleUsers = await _mumbleService.GetRegisteredUsersAsync("");
            var mumbleEntry = mumbleUsers.FirstOrDefault(m => m.Value == user.DisplayName);
            
            if (mumbleEntry.Key > 0)
            {
                try
                {
                    await _mumbleService.UnregisterUserAsync(mumbleEntry.Key);
                    _logger.LogInformation("Unregistered Mumble user {MumbleUserId} for {DisplayName}", 
                        mumbleEntry.Key, user.DisplayName);
                }
                catch (Exception mumbleEx)
                {
                    _logger.LogError(mumbleEx, "Failed to unregister user {DisplayName} from Mumble", user.DisplayName);
                    // Continue with SQLite deletion even if Mumble unregister fails
                }
            }

            // Delete from SQLite
            await _userRepo.DeleteAsync(userId);
            _logger.LogWarning("Admin deleted user {UserId} ({DisplayName})", userId, user.DisplayName);

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting user {UserId}", userId);
            return false;
        }
    }

    /// <summary>
    /// Validate display name according to Mumble rules (no spaces, max 64 chars)
    /// </summary>
    public static (bool isValid, string? error) ValidateDisplayName(string displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return (false, "Display name is required");
        
        if (displayName.Length > 64)
            return (false, "Display name must be 64 characters or less");
            
        if (displayName.Contains(' '))
            return (false, "Display name cannot contain spaces");
            
        return (true, null);
    }
}
