using Brmble.Server.Auth;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public class LiveKitService
{
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
                CanSubscribe = false
            })
            .WithTtl(TimeSpan.FromHours(6));

        return token.ToJwt();
    }
}
