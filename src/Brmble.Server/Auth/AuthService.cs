// src/Brmble.Server/Auth/AuthService.cs
namespace Brmble.Server.Auth;

public record AuthResult(string MatrixAccessToken);

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
}

public class AuthService : IActiveBrmbleSessions
{
    private readonly UserRepository _userRepository;
    private readonly HashSet<string> _activeSessions = [];
    private readonly object _lock = new();

    public AuthService(UserRepository userRepository)
    {
        _userRepository = userRepository;
    }

    public bool IsBrmbleClient(string certHash) => _activeSessions.Contains(certHash);

    public async Task<AuthResult> Authenticate(string certHash, string displayName)
    {
        var user = await _userRepository.GetByCertHash(certHash);

        if (user is null)
        {
            user = await _userRepository.Insert(certHash, displayName);
        }
        else if (user.DisplayName != displayName)
        {
            await _userRepository.UpdateDisplayName(user.Id, displayName);
        }

        lock (_lock)
        {
            _activeSessions.Add(certHash);
        }

        return new AuthResult($"stub_token_{user.Id}");
    }

    public void Deactivate(string certHash)
    {
        lock (_lock)
        {
            _activeSessions.Remove(certHash);
        }
    }
}
