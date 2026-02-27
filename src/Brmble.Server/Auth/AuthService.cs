// src/Brmble.Server/Auth/AuthService.cs
using System.Collections.Concurrent;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Auth;

public record AuthResult(string MatrixUserId, string MatrixAccessToken, string DisplayName);

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
    bool IsBrmbleClientByName(string mumbleName);
    void TrackMumbleName(string mumbleName);
    void UntrackMumbleName(string mumbleName);
}

public class AuthService : IActiveBrmbleSessions
{
    private readonly UserRepository _userRepository;
    private readonly IMatrixAppService _matrixAppService;
    private readonly ILogger<AuthService> _logger;
    private readonly HashSet<string> _activeSessions = [];
    private readonly HashSet<string> _activeNames = [];
    private readonly Dictionary<string, string> _certToName = [];
    private readonly object _lock = new();
    // Parks display names from Mumble UserState events that arrive before the user's first Authenticate call.
    // Entries are consumed atomically by Authenticate and are not persisted across restarts.
    private readonly ConcurrentDictionary<string, string> _pendingNames = new();

    public AuthService(UserRepository userRepository, IMatrixAppService matrixAppService, ILogger<AuthService> logger)
    {
        _userRepository = userRepository;
        _matrixAppService = matrixAppService;
        _logger = logger;
    }

    public bool IsBrmbleClient(string certHash)
    {
        lock (_lock) { return _activeSessions.Contains(certHash); }
    }
    public bool IsBrmbleClientByName(string mumbleName)
    {
        lock (_lock) { return _activeNames.Contains(mumbleName); }
    }
    public void TrackMumbleName(string mumbleName)
    {
        lock (_lock) { _activeNames.Add(mumbleName); }
    }
    public void UntrackMumbleName(string mumbleName)
    {
        lock (_lock) { _activeNames.Remove(mumbleName); }
    }

    public async Task<AuthResult> Authenticate(string certHash, string? mumbleUsername = null)
    {
        var user = await _userRepository.GetByCertHash(certHash);

        if (user is null)
        {
            // Prefer the name passed directly from the auth request, fall back to ICE-parked name
            var displayName = mumbleUsername;
            if (string.IsNullOrEmpty(displayName))
                _pendingNames.TryRemove(certHash, out displayName);
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

        lock (_lock)
        {
            _activeSessions.Add(certHash);
        }

        return new AuthResult(user.MatrixUserId, user.MatrixAccessToken!, user.DisplayName);
    }

    public void Deactivate(string certHash)
    {
        lock (_lock)
        {
            _activeSessions.Remove(certHash);
            if (_certToName.Remove(certHash, out var name))
                _activeNames.Remove(name);
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
                var localpart = user.MatrixUserId.Split(':')[0].TrimStart('@');
                try { await _matrixAppService.SetDisplayName(localpart, displayName); }
                catch (Exception ex) { _logger.LogDebug(ex, "Failed to sync display name for {UserId}", user.MatrixUserId); }
            }
        }
        else
        {
            _pendingNames[certHash] = displayName;
        }
    }
}
