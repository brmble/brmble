using Brmble.Server.Auth;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Matrix;

public class MatrixEventHandler : IMumbleEventHandler
{
    private readonly MatrixService _matrixService;
    private readonly IActiveBrmbleSessions _activeSessions;
    private readonly IMatrixAppService _appService;
    private readonly UserRepository _userRepository;
    private readonly ILogger<MatrixEventHandler> _logger;

    public MatrixEventHandler(
        MatrixService matrixService,
        IActiveBrmbleSessions activeSessions,
        IMatrixAppService appService,
        UserRepository userRepository,
        ILogger<MatrixEventHandler> logger)
    {
        _matrixService = matrixService;
        _activeSessions = activeSessions;
        _appService = appService;
        _userRepository = userRepository;
        _logger = logger;
    }

    public Task OnUserConnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserDisconnected(MumbleUser user)
    {
        _activeSessions.UntrackMumbleName(user.Name);
        return Task.CompletedTask;
    }

    public async Task OnUserTextureAvailable(MumbleUser user, byte[] textureData)
    {
        if (string.IsNullOrEmpty(user.CertHash)) return;

        var dbUser = await _userRepository.GetByCertHash(user.CertHash);
        if (dbUser is null) return;

        var avatarSource = await _userRepository.GetAvatarSource(dbUser.Id);
        if (avatarSource == "brmble")
        {
            _logger.LogDebug("Skipping Mumble texture for {User}: Brmble avatar takes priority", user.Name);
            return;
        }

        // Detect content type from magic bytes
        var contentType = DetectImageContentType(textureData);
        if (contentType is null)
        {
            _logger.LogWarning("Mumble texture for {User} has unrecognized format, skipping", user.Name);
            return;
        }

        try
        {
            var localpart = dbUser.MatrixUserId.Split(':')[0].TrimStart('@');
            var ext = contentType switch
            {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                _ => "bin"
            };
            var mxcUrl = await _appService.UploadMedia(textureData, contentType, $"avatar.{ext}");
            await _appService.SetAvatarUrl(localpart, mxcUrl);
            await _userRepository.SetAvatarSource(dbUser.Id, "mumble");
            _logger.LogInformation("Set Mumble texture as avatar for {User}", user.Name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upload Mumble texture for {User}", user.Name);
        }
    }

    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId)
        => _matrixService.RelayMessage(sender, text, channelId);

    public Task OnChannelCreated(MumbleChannel channel)
        => _matrixService.EnsureChannelRoom(channel);

    public Task OnChannelRemoved(MumbleChannel channel)
        => _matrixService.DeleteChannelRoomAsync(channel.Id);

    public Task OnChannelRenamed(MumbleChannel channel)
        => _matrixService.RenameChannelRoom(channel);

    private static string? DetectImageContentType(byte[] data)
    {
        if (data.Length < 4) return null;
        if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "image/png";
        if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";
        if (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46) return "image/gif";
        if (data.Length >= 12 &&
            data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
            data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50) return "image/webp";
        return null;
    }
}
