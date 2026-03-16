using Microsoft.Extensions.Logging;

namespace Brmble.Server.Mumble;

public class MumbleRegistrationService : IMumbleRegistrationService
{
    private readonly ILogger<MumbleRegistrationService> _logger;
    private volatile MumbleServer.ServerPrx? _serverProxy;

    public MumbleRegistrationService(ILogger<MumbleRegistrationService> logger)
    {
        _logger = logger;
    }

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    private MumbleServer.ServerPrx GetProxy()
    {
        return _serverProxy ?? throw new MumbleRegistrationException(
            "Mumble ICE server proxy is not available. Cannot perform registration operations.");
    }

    public async Task<(bool IsRegistered, int UserId)> GetRegistrationStatusAsync(int sessionId)
    {
        var proxy = GetProxy();
        try
        {
            var state = await proxy.getStateAsync(sessionId);
            var isRegistered = state.userid >= 0;
            _logger.LogDebug(
                "Registration status for session {SessionId}: registered={IsRegistered}, userid={UserId}",
                sessionId, isRegistered, state.userid);
            return (isRegistered, state.userid);
        }
        catch (MumbleServer.InvalidSessionException)
        {
            throw new MumbleRegistrationException($"Mumble session {sessionId} not found.");
        }
        catch (Exception ex) when (ex is not MumbleRegistrationException)
        {
            throw new MumbleRegistrationException($"ICE error checking session {sessionId}.", ex);
        }
    }

    public async Task<string?> GetRegisteredNameAsync(int userId)
    {
        var proxy = GetProxy();
        try
        {
            var info = await proxy.getRegistrationAsync(userId);
            info.TryGetValue(MumbleServer.UserInfo.UserName, out var name);
            return name;
        }
        catch (MumbleServer.InvalidUserException)
        {
            return null;
        }
        catch (Exception ex) when (ex is not MumbleRegistrationException)
        {
            throw new MumbleRegistrationException($"ICE error getting registration for user {userId}.", ex);
        }
    }

    public async Task<int> RegisterUserAsync(string name, string certHash)
    {
        var proxy = GetProxy();
        var info = new Dictionary<MumbleServer.UserInfo, string>
        {
            { MumbleServer.UserInfo.UserName, name },
            { MumbleServer.UserInfo.UserHash, certHash }
        };

        try
        {
            var newUserId = await proxy.registerUserAsync(info);
            _logger.LogInformation(
                "Registered user '{Name}' in Mumble with userId={UserId}",
                name, newUserId);
            return newUserId;
        }
        catch (MumbleServer.InvalidUserException)
        {
            throw new MumbleNameConflictException(name);
        }
        catch (Exception ex) when (ex is not MumbleNameConflictException)
        {
            throw new MumbleRegistrationException($"ICE error registering user '{name}'.", ex);
        }
    }
}
