namespace Brmble.Server.Auth;

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
}

public class AuthService : IActiveBrmbleSessions
{
    private readonly UserRepository _userRepository;
    private readonly HashSet<string> _activeSessions = [];

    public AuthService(UserRepository userRepository)
    {
        _userRepository = userRepository;
    }

    public bool IsBrmbleClient(string certHash) => _activeSessions.Contains(certHash);

    // TODO: Authenticate(string certHash, string displayName) → MatrixTokenResponse
    //   - Look up user by cert hash
    //   - If not found: provision Matrix account, insert user row
    //   - Add certHash to _activeSessions
    //   - Return Matrix access token
    //
    // TODO: Deactivate(string certHash) — called on disconnect
    //   - Remove certHash from _activeSessions
}
