using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Events;

public class SessionMappingHandler : IMumbleEventHandler
{
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly UserRepository _userRepository;
    private readonly IActiveBrmbleSessions _activeSessions;
    private readonly ILogger<SessionMappingHandler> _logger;

    public SessionMappingHandler(
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        UserRepository userRepository,
        IActiveBrmbleSessions activeSessions,
        ILogger<SessionMappingHandler> logger)
    {
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _userRepository = userRepository;
        _activeSessions = activeSessions;
        _logger = logger;
    }

    public async Task OnUserConnected(MumbleUser user)
    {
        if (string.IsNullOrEmpty(user.CertHash)) return;

        var dbUser = await _userRepository.GetByCertHash(user.CertHash);
        if (dbUser is null) return;
        var companionId = await _userRepository.GetCompanionId(dbUser.Id);

        _activeSessions.TrackMumbleName(user.Name, user.CertHash);
        var isBrmbleClient = _activeSessions.IsBrmbleClient(user.CertHash);

        var mappingAdded = _sessionMapping.TryAddMatrixUser(user.SessionId, dbUser.MatrixUserId, user.Name, dbUser.Id, companionId);
        _sessionMapping.TryUpdateCertHash(user.SessionId, user.CertHash);
        _sessionMapping.TryUpdateBrmbleStatus(user.SessionId, isBrmbleClient);

        _logger.LogInformation(
            "Mapped session {Session} ({Name}) to {MatrixUserId} via cert (brmbleClient={IsBrmble}, added={Added})",
            user.SessionId, user.Name, dbUser.MatrixUserId, isBrmbleClient, mappingAdded);
        await _eventBus.BroadcastAsync(new
        {
            type = "userMappingAdded",
            sessionId = user.SessionId,
            matrixUserId = dbUser.MatrixUserId,
            mumbleName = user.Name,
            companionId,
            certHash = user.CertHash,
            isBrmbleClient
        });

        if (!mappingAdded && isBrmbleClient)
        {
            await _eventBus.BroadcastAsync(new
            {
                type = "brmbleClientActivated",
                sessionId = user.SessionId
            });
        }
    }

    public Task OnUserDisconnected(MumbleUser user) => Task.CompletedTask;
    public Task OnUserTextureAvailable(MumbleUser user, byte[] textureData) => Task.CompletedTask;
    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId) => Task.CompletedTask;
    public Task OnChannelCreated(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRemoved(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRenamed(MumbleChannel channel) => Task.CompletedTask;
}
