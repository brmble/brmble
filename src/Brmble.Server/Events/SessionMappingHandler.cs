using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Events;

public class SessionMappingHandler : IMumbleEventHandler
{
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly UserRepository _userRepository;
    private readonly ILogger<SessionMappingHandler> _logger;

    public SessionMappingHandler(
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        UserRepository userRepository,
        ILogger<SessionMappingHandler> logger)
    {
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _userRepository = userRepository;
        _logger = logger;
    }

    public async Task OnUserConnected(MumbleUser user)
    {
        if (string.IsNullOrEmpty(user.CertHash)) return;

        var dbUser = await _userRepository.GetByCertHash(user.CertHash);
        if (dbUser is null) return;

        if (_sessionMapping.TryAddMatrixUser(user.SessionId, dbUser.MatrixUserId, user.Name))
        {
            _logger.LogInformation(
                "Mapped session {Session} ({Name}) to {MatrixUserId} via cert",
                user.SessionId, user.Name, dbUser.MatrixUserId);
            await _eventBus.BroadcastAsync(new
            {
                type = "userMappingAdded",
                sessionId = user.SessionId,
                matrixUserId = dbUser.MatrixUserId,
                mumbleName = user.Name
            });
        }
    }

    public Task OnUserDisconnected(MumbleUser user) => Task.CompletedTask;
    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId) => Task.CompletedTask;
    public Task OnChannelCreated(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRemoved(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRenamed(MumbleChannel channel) => Task.CompletedTask;
}
