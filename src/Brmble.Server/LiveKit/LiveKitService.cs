using Brmble.Server.Auth;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public sealed record LiveKitTokenMetadata(string Token, DateTimeOffset ExpiresAt);

public class LiveKitService : ILiveKitRoomQuery, ILiveKitParticipantRemover
{
    private static readonly TimeSpan DefaultTokenTtl = TimeSpan.FromHours(1);

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

    [Obsolete("Use GenerateToken(certHash, roomName, accessMode) so LiveKit token scope is explicit by access mode.")]
    public Task<string?> GenerateToken(string certHash, string roomName)
    {
        return GenerateToken(certHash, roomName, LiveKitAccessMode.Publish);
    }

    public async Task<string?> GenerateToken(string certHash, string roomName, LiveKitAccessMode accessMode)
    {
        var user = await _userRepo.GetByCertHash(certHash);
        if (user is null)
        {
            _logger.LogWarning("Token request for unknown cert hash: {CertHash}", certHash);
            return null;
        }

        var grants = accessMode switch
        {
            LiveKitAccessMode.Subscribe => new VideoGrants
            {
                RoomJoin = true,
                Room = roomName,
                CanPublish = false,
                CanSubscribe = true,
            },
            LiveKitAccessMode.Publish => new VideoGrants
            {
                RoomJoin = true,
                Room = roomName,
                CanPublish = true,
                CanSubscribe = true,
            },
            _ => throw new ArgumentOutOfRangeException(nameof(accessMode), accessMode, null),
        };

        var token = new AccessToken(_settings.ApiKey, _settings.ApiSecret)
            .WithIdentity(user.MatrixUserId)
            .WithName(user.DisplayName)
            .WithGrants(grants)
            .WithTtl(DefaultTokenTtl);

        return token.ToJwt();
    }

    public async Task<LiveKitTokenMetadata?> GenerateTokenMetadata(
        string certHash,
        string roomName,
        LiveKitAccessMode accessMode,
        DateTimeOffset issuedAt)
    {
        var token = await GenerateToken(certHash, roomName, accessMode);
        if (token is null)
            return null;

        return new LiveKitTokenMetadata(token, issuedAt.Add(DefaultTokenTtl));
    }

    public Task<LiveKitAuthorizationResult> AuthorizeTokenRequest(
        string certHash,
        string roomName,
        LiveKitAccessMode accessMode,
        bool canPublish,
        bool canSubscribe)
    {
        if (string.IsNullOrWhiteSpace(certHash))
            return Task.FromResult(LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.Unauthorized));

        if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
            return Task.FromResult(LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.InvalidRoom));

        var allowed = accessMode switch
        {
            LiveKitAccessMode.Publish => canPublish,
            LiveKitAccessMode.Subscribe => canSubscribe,
            _ => false,
        };

        return Task.FromResult(
            allowed
                ? LiveKitAuthorizationResult.Success(certHash, roomName, accessMode)
                : LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.Forbidden));
    }

    public async Task<bool> RemoveParticipant(string roomName, string participantIdentity)
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
            return true;
        }
        catch (Exception ex)
        {
            // Idempotent: if room/participant doesn't exist, that's fine
            _logger.LogDebug(ex, "Could not remove participant {Identity} from room {Room} (may not exist)", participantIdentity, roomName);
            return false;
        }
    }

    public async Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName)
    {
        try
        {
            var roomService = new RoomServiceClient(
                _settings.ServerUrl,
                _settings.ApiKey,
                _settings.ApiSecret);

            var response = await roomService.ListParticipants(new Livekit.Server.Sdk.Dotnet.ListParticipantsRequest
            {
                Room = roomName
            });

            return response.Participants.Select(p => p.Identity).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not list participants in room {Room}", roomName);
            return Array.Empty<string>();
        }
    }
}
