using Brmble.Server.Auth;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public class LiveKitService
{
    private static readonly TimeSpan DefaultTokenTtl = TimeSpan.FromHours(6);

    private readonly LiveKitSettings _settings;
    private readonly UserRepository _userRepo;
    private readonly ILogger<LiveKitService> _logger;

    public LiveKitService(
        IOptions<LiveKitSettings> settings,
        UserRepository userRepo,
        ILogger<LiveKitService> logger)
    {
        _settings = settings.Value;
        _userRepo = userRepo;
        _logger = logger;
    }

    public async Task<string?> GenerateToken(string certHash, string roomName)
    {
        var user = await _userRepo.GetByCertHash(certHash);
        if (user is null)
        {
            _logger.LogWarning("Token request for unknown cert hash: {CertHash}", certHash);
            return null;
        }

        var token = new AccessToken(_settings.ApiKey, _settings.ApiSecret)
            .WithIdentity(user.MatrixUserId)
            .WithName(user.DisplayName)
            .WithGrants(new VideoGrants
            {
                RoomJoin = true,
                Room = roomName,
                CanPublish = true,
                CanSubscribe = true
            })
            .WithTtl(DefaultTokenTtl);

        return token.ToJwt();
    }

    public async Task RemoveParticipant(string roomName, string participantIdentity)
    {
        try
        {
            var roomService = new RoomServiceClient(
                _settings.ServerUrl,
                _settings.ApiKey,
                _settings.ApiSecret);

            await roomService.RemoveParticipant(new Livekit.Server.Sdk.Dotnet.RoomParticipantIdentity
            {
                Room = roomName,
                Identity = participantIdentity
            });

            _logger.LogInformation("Removed participant {Identity} from room {Room}", participantIdentity, roomName);
        }
        catch (Exception ex)
        {
            // Idempotent: if room/participant doesn't exist, that's fine
            _logger.LogDebug(ex, "Could not remove participant {Identity} from room {Room} (may not exist)", participantIdentity, roomName);
        }
    }
}
