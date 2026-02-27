// src/Brmble.Server/Auth/AuthService.cs
using System.Collections.Concurrent;
using Brmble.Server.Matrix;

namespace Brmble.Server.Auth;

public record AuthResult(string MatrixUserId, string MatrixAccessToken, string DisplayName);

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
}

public class AuthService : IActiveBrmbleSessions
{
    private readonly UserRepository _userRepository;
    private readonly IMatrixAppService _matrixAppService;
    private readonly HashSet<string> _activeSessions = [];
    private readonly object _lock = new();
    // Parks display names from Mumble UserState events that arrive before the user's first Authenticate call.
    // Entries are consumed atomically by Authenticate and are not persisted across restarts.
    private readonly ConcurrentDictionary<string, string> _pendingNames = new();

    public AuthService(UserRepository userRepository, IMatrixAppService matrixAppService)
    {
        _userRepository = userRepository;
        _matrixAppService = matrixAppService;
    }

    public bool IsBrmbleClient(string certHash) => _activeSessions.Contains(certHash);

    public async Task<AuthResult> Authenticate(string certHash)
    {
        var user = await _userRepository.GetByCertHash(certHash);

        if (user is null)
        {
            _pendingNames.TryRemove(certHash, out var pendingName);
            user = await _userRepository.Insert(certHash, pendingName);
            var token = await _matrixAppService.RegisterUser(user.Id.ToString(), user.DisplayName);
            await _userRepository.UpdateMatrixToken(user.Id, token);
            user = user with { MatrixAccessToken = token };
        }
        else if (user.MatrixAccessToken is null)
        {
            var token = await _matrixAppService.LoginUser(user.Id.ToString());
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
        }
    }

    public async Task HandleUserState(string certHash, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return;

        var user = await _userRepository.GetByCertHash(certHash);
        if (user is not null)
        {
            if (user.DisplayName != displayName)
                await _userRepository.UpdateDisplayName(user.Id, displayName);
        }
        else
        {
            _pendingNames[certHash] = displayName;
        }
    }
}
