// src/Brmble.Server/Auth/AuthService.cs
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;

namespace Brmble.Server.Auth;

public record AuthResult(long UserId, string MatrixUserId, string MatrixAccessToken, string DisplayName, bool IsRegistered = false)
{
    /// <summary>Extracts the localpart (e.g. "1") from a full Matrix user ID (e.g. "@1:server").</summary>
    public string Localpart => MatrixUserIdHelper.GetLocalpart(MatrixUserId);
}

internal static class MatrixUserIdHelper
{
    /// <summary>Extracts the localpart (e.g. "1") from a full Matrix user ID (e.g. "@1:server").</summary>
    public static string GetLocalpart(string matrixUserId) => matrixUserId.Split(':')[0].TrimStart('@');
}

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
    bool IsBrmbleClientByName(string mumbleName);
    void TrackMumbleName(string mumbleName, string? certHash = null);
    void UntrackMumbleName(string mumbleName);
}

public class AuthService : IActiveBrmbleSessions
{
    private static readonly Regex InvalidCharsRegex =
        new(@"[\x00-\x1F/#]", RegexOptions.Compiled);

    private readonly UserRepository _userRepository;
    private readonly IMatrixAppService _matrixAppService;
    private readonly ILogger<AuthService> _logger;
    private readonly IMumbleRegistrationService _mumbleRegistration;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly HashSet<string> _activeSessions = [];
    private readonly HashSet<string> _activeNames = [];
    private readonly Dictionary<string, string> _certToName = [];
    private readonly object _lock = new();
    // Parks display names from Mumble UserState events that arrive before the user's first Authenticate call.
    // Entries are consumed atomically by Authenticate and are not persisted across restarts.
    private readonly ConcurrentDictionary<string, string> _pendingNames = new();

    public AuthService(
        UserRepository userRepository,
        IMatrixAppService matrixAppService,
        ILogger<AuthService> logger,
        IMumbleRegistrationService mumbleRegistration,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus)
    {
        _userRepository = userRepository;
        _matrixAppService = matrixAppService;
        _logger = logger;
        _mumbleRegistration = mumbleRegistration;
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
    }

    public bool IsBrmbleClient(string certHash)
    {
        lock (_lock) { return _activeSessions.Contains(certHash); }
    }
    public bool IsBrmbleClientByName(string mumbleName)
    {
        lock (_lock) { return _activeNames.Contains(mumbleName); }
    }
    public void TrackMumbleName(string mumbleName, string? certHash = null)
    {
        lock (_lock)
        {
            if (certHash is not null)
            {
                if (_certToName.TryGetValue(certHash, out var existingName) && existingName != mumbleName)
                {
                    _activeNames.Remove(existingName);
                }

                _certToName[certHash] = mumbleName;
            }

            _activeNames.Add(mumbleName);
        }
    }
    public void UntrackMumbleName(string mumbleName)
    {
        lock (_lock) { _activeNames.Remove(mumbleName); }
    }

    public static (bool IsValid, string? Error) ValidateMumbleUsername(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return (false, "Username cannot be empty.");

        if (name.Length > 128)
            return (false, "Username must be 128 characters or fewer.");

        if (InvalidCharsRegex.IsMatch(name))
            return (false, "Username contains invalid characters.");

        return (true, null);
    }

    /// <summary>
    /// Resolves the authoritative username from Mumble's registration system.
    /// Returns the name to use for the Brmble account.
    /// Throws MumbleNameConflictException if the requested name is taken.
    /// Throws MumbleRegistrationException if ICE is unavailable.
    /// </summary>
    public async Task<string> ResolveMumbleNameAsync(string mumbleName, string certHash)
    {
        if (!_sessionMapping.TryGetSessionId(mumbleName, out var sessionId))
        {
            _logger.LogWarning("No Mumble session found for name '{Name}' during registration", mumbleName);
            throw new MumbleRegistrationException($"No active Mumble session found for '{mumbleName}'.");
        }

        var (isRegistered, mumbleUserId) = await _mumbleRegistration.GetRegistrationStatusAsync(sessionId);

        if (isRegistered)
        {
            var registeredName = await _mumbleRegistration.GetRegisteredNameAsync(mumbleUserId);
            if (!string.IsNullOrEmpty(registeredName))
            {
                _logger.LogInformation(
                    "User already registered in Mumble as '{RegisteredName}', ignoring requested name '{RequestedName}'",
                    registeredName, mumbleName);
                return registeredName;
            }
        }

        var (valid, error) = ValidateMumbleUsername(mumbleName);
        if (!valid)
            throw new MumbleRegistrationException(error!);

        await _mumbleRegistration.RegisterUserAsync(mumbleName, certHash);
        _logger.LogInformation("Registered '{Name}' in Mumble for cert", mumbleName);
        return mumbleName;
    }

    public async Task<AuthResult> Authenticate(string certHash, string? mumbleUsername = null)
    {
        var user = await _userRepository.GetByCertHash(certHash);
        bool isRegistered = false;

        if (user is null)
        {
            // Prefer the name passed directly from the auth request, fall back to ICE-parked name
            var displayName = mumbleUsername;
            if (string.IsNullOrEmpty(displayName))
                _pendingNames.TryRemove(certHash, out displayName);

            // Resolve name from Mumble registration (authoritative)
            if (!string.IsNullOrEmpty(displayName))
            {
                try
                {
                    displayName = await ResolveMumbleNameAsync(displayName, certHash);
                    isRegistered = true;
                }
                catch (MumbleRegistrationException ex)
                {
                    // ICE unavailable or no session — log and proceed with unverified name
                    _logger.LogWarning(ex, "Could not verify Mumble registration, using unverified name");
                }
                // MumbleNameConflictException propagates to caller
            }

            user = await _userRepository.Insert(certHash, displayName);
            string token;
            try
            {
                token = await _matrixAppService.RegisterUser(user.Id.ToString(), user.DisplayName);
            }
            catch (Exception ex)
            {
                // User may already exist on the homeserver (e.g. after local DB reset) — fall back to login
                _logger.LogDebug(ex, "Registration failed for user {UserId}, falling back to login", user.MatrixUserId);
                token = await _matrixAppService.LoginUser(user.Id.ToString());
            }
            await _userRepository.UpdateMatrixToken(user.Id, token);
            user = user with { MatrixAccessToken = token };
        }
        else if (user.MatrixAccessToken is null)
        {
            string token;
            try
            {
                token = await _matrixAppService.LoginUser(user.Id.ToString());
            }
            catch (Exception ex)
            {
                // User may not exist on the homeserver (e.g. after volume reset) — re-register
                _logger.LogDebug(ex, "Login failed for user {UserId}, falling back to registration", user.MatrixUserId);
                token = await _matrixAppService.RegisterUser(user.Id.ToString(), user.DisplayName);
            }
            await _userRepository.UpdateMatrixToken(user.Id, token);
            user = user with { MatrixAccessToken = token };
        }

        // Reconcile name with Mumble registration for existing users
        if (user is not null && !isRegistered && !string.IsNullOrEmpty(mumbleUsername)
            && _sessionMapping.TryGetSessionId(mumbleUsername, out var existingSid))
        {
            try
            {
                var (isReg, muId) = await _mumbleRegistration.GetRegistrationStatusAsync(existingSid);
                if (isReg)
                {
                    isRegistered = true;
                    var regName = await _mumbleRegistration.GetRegisteredNameAsync(muId);
                    if (!string.IsNullOrEmpty(regName) && regName != user.DisplayName)
                    {
                        await _userRepository.UpdateDisplayName(user.Id, regName);
                        user = user with { DisplayName = regName };
                        _logger.LogInformation("Reconciled display name to Mumble registration: '{Name}'", regName);
                    }
                }
                else if (user.DisplayName != $"user_{user.Id}")
                {
                    try
                    {
                        await _mumbleRegistration.RegisterUserAsync(user.DisplayName, certHash);
                        isRegistered = true;
                        _logger.LogInformation("Auto-registered existing user '{Name}' in Mumble", user.DisplayName);
                    }
                    catch (MumbleNameConflictException)
                    {
                        var previousName = user.DisplayName;
                        var fallback = $"user_{user.Id}";
                        await _userRepository.UpdateDisplayName(user.Id, fallback);
                        user = user with { DisplayName = fallback };
                        _logger.LogWarning("Existing name '{Name}' conflicted, reset to '{Fallback}'", previousName, fallback);
                    }
                }
            }
            catch (MumbleRegistrationException ex)
            {
                _logger.LogWarning(ex, "Could not reconcile Mumble registration for existing user");
            }
        }

        lock (_lock)
        {
            _activeSessions.Add(certHash);
        }

        // Broadcast Brmble client activation
        if (_sessionMapping.TryGetSessionByUserId(user!.Id, out var activatedSessionId))
        {
            _sessionMapping.TryUpdateBrmbleStatus(activatedSessionId, true);
            _ = _eventBus.BroadcastAsync(new
            {
                type = "brmbleClientActivated",
                sessionId = activatedSessionId
            });
        }

        return new AuthResult(user.Id, user.MatrixUserId, user.MatrixAccessToken!, user.DisplayName, isRegistered);
    }

    public void Deactivate(string certHash)
    {
        lock (_lock)
        {
            _activeSessions.Remove(certHash);
            if (_certToName.Remove(certHash, out var name))
            {
                _activeNames.Remove(name);
                // Broadcast Brmble client deactivation
                if (_sessionMapping.TryGetSessionId(name, out var deactivatedSessionId))
                {
                    _sessionMapping.TryUpdateBrmbleStatus(deactivatedSessionId, false);
                    _ = _eventBus.BroadcastAsync(new
                    {
                        type = "brmbleClientDeactivated",
                        sessionId = deactivatedSessionId
                    });
                }
            }
        }
    }

    public async Task HandleUserState(string certHash, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return;

        // Track the Mumble name for active Brmble sessions so ICE relay can skip them
        lock (_lock)
        {
            if (_activeSessions.Contains(certHash))
            {
                if (_certToName.TryGetValue(certHash, out var oldName))
                    _activeNames.Remove(oldName);
                _activeNames.Add(displayName);
                _certToName[certHash] = displayName;
            }
        }

        var user = await _userRepository.GetByCertHash(certHash);
        if (user is not null)
        {
            if (user.DisplayName != displayName)
            {
                await _userRepository.UpdateDisplayName(user.Id, displayName);
                try { await _matrixAppService.SetDisplayName(MatrixUserIdHelper.GetLocalpart(user.MatrixUserId), displayName); }
                catch (Exception ex) { _logger.LogDebug(ex, "Failed to sync display name for {UserId}", user.MatrixUserId); }
            }
        }
        else
        {
            _pendingNames[certHash] = displayName;
        }
    }
}
