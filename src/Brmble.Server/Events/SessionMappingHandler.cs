using Brmble.Server.Auth;
using Brmble.Server.Companions;
using Brmble.Server.Mumble;

namespace Brmble.Server.Events;

public class SessionMappingHandler : IMumbleEventHandler
{
    private readonly ISessionMappingService _sessionMapping;
    private readonly IMappingEventPublisher _publisher;
    private readonly UserRepository _userRepository;
    private readonly IActiveBrmbleSessions _activeSessions;
    private readonly ILogger<SessionMappingHandler> _logger;

    public SessionMappingHandler(
        ISessionMappingService sessionMapping,
        IMappingEventPublisher publisher,
        UserRepository userRepository,
        IActiveBrmbleSessions activeSessions,
        ILogger<SessionMappingHandler> logger)
    {
        _sessionMapping = sessionMapping;
        _publisher = publisher;
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
        // A registered WebSocket proves true. Nothing proves false here: after a restart
        // _activeSessions is empty, so "not active" only means "not known yet". Publishing
        // false would assert something we cannot know, and clients would believe it.
        bool? isBrmbleClient = _activeSessions.IsBrmbleClient(user.CertHash) ? true : null;

        var wire = CompanionWireSelection.FromPersisted(companionId);
        var mappingAdded = false;
        var announced = default(MappingEnvelope);
        await _publisher.PublishAsync(
            // The mutations run inside the lock so the revision stamped below is provably the
            // one they produced. Doing them outside lets a concurrent registration bump the
            // counter in between, and two payloads then claim the same revision.
            () =>
            {
                mappingAdded = _sessionMapping.TryAddMatrixUser(
                    user.SessionId, dbUser.MatrixUserId, user.Name, dbUser.Id, companionId);
                _sessionMapping.TryUpdateCertHash(user.SessionId, user.CertHash);
                _sessionMapping.TryUpdateBrmbleStatus(user.SessionId, isBrmbleClient);
                return true;
            },
            envelope =>
            {
                announced = envelope;
                // A dictionary rather than an anonymous type so isBrmbleClient can be omitted
                // when unknown: an explicit null throws in the shipped client's parser.
                // Keys are written in camelCase and pass through both serialiser configs
                // unchanged, since DictionaryKeyPolicy is not set on the event bus.
                var payload = new Dictionary<string, object?>
                {
                    ["type"] = "userMappingAdded",
                    ["instanceId"] = envelope.InstanceId,
                    ["baseRevision"] = envelope.BaseRevision,
                    ["revision"] = envelope.Revision,
                    ["sessionId"] = user.SessionId,
                    ["matrixUserId"] = dbUser.MatrixUserId,
                    ["mumbleName"] = user.Name,
                    ["companionId"] = wire.CompanionId,
                    ["customCompanionId"] = wire.CustomCompanionId,
                    ["certHash"] = user.CertHash
                };
                if (isBrmbleClient.HasValue)
                    payload["isBrmbleClient"] = isBrmbleClient.Value;
                return payload;
            });

        _logger.LogInformation(
            "Mapped session {Session} ({Name}) to {MatrixUserId} via cert (brmbleClient={IsBrmble}, added={Added})",
            user.SessionId, user.Name, dbUser.MatrixUserId, isBrmbleClient, mappingAdded);

        if (!mappingAdded && isBrmbleClient == true)
        {
            // A legacy-compatibility restatement of a fact the userMappingAdded above already
            // carries; it performs no mutation of its own. It therefore reuses that payload's
            // envelope rather than reading the counter again — a fresh read could pick up an
            // unrelated concurrent bump and claim another event's revision.
            await _publisher.PublishAsync(
                () => true,
                _ => new
                {
                    type = "brmbleClientActivated",
                    instanceId = announced.InstanceId,
                    baseRevision = announced.BaseRevision,
                    revision = announced.Revision,
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
