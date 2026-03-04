using System.Text.RegularExpressions;
using System.Web;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixService
{
    private static readonly Regex ImgRegex = new(
        @"<img\s+[^>]*src=[""']data:(image/[^;]+);base64,([^""']+)[""'][^>]*/?>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> AllowedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/gif", "image/webp"
    };

    private const int MaxImageSizeBytes = 5 * 1024 * 1024;

    private static readonly Dictionary<string, string> MimeToExtension = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/gif"] = "gif",
        ["image/webp"] = "webp",
    };

    private readonly ChannelRepository _channelRepository;
    private readonly IMatrixAppService _appService;
    private readonly IActiveBrmbleSessions _activeSessions;
    private readonly ILogger<MatrixService> _logger;

    public MatrixService(
        ChannelRepository channelRepository,
        IMatrixAppService appService,
        IActiveBrmbleSessions activeSessions,
        ILogger<MatrixService> logger)
    {
        _channelRepository = channelRepository;
        _appService = appService;
        _activeSessions = activeSessions;
        _logger = logger;
    }

    public async Task RelayMessage(MumbleUser sender, string text, int channelId)
    {
        if (_activeSessions.IsBrmbleClient(sender.CertHash) || _activeSessions.IsBrmbleClientByName(sender.Name))
        {
            _logger.LogDebug("Skipping relay for Brmble client {User}", sender.Name);
            return;
        }

        var roomId = await _channelRepository.GetRoomIdAsync(channelId);
        if (roomId is null)
        {
            _logger.LogWarning("No Matrix room mapped for Mumble channel {ChannelId} — message from {User} dropped", channelId, sender.Name);
            return;
        }

        // Extract and upload base64 images
        var remaining = text;
        var matches = ImgRegex.Matches(text);
        int offset = 0;
        foreach (Match match in matches)
        {
            var mimetype = match.Groups[1].Value;
            var b64Data = match.Groups[2].Value;

            if (!AllowedMimeTypes.Contains(mimetype))
            {
                _logger.LogWarning("Skipping image: unsupported mimetype {Mime}", mimetype);
                continue;
            }

            // ICE/Mumble may URL-encode the data URI content — decode before base64
            var rawB64 = b64Data;
            byte[] imageData;
            try
            {
                rawB64 = Uri.UnescapeDataString(b64Data);
                imageData = Convert.FromBase64String(rawB64);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Skipping image: base64 decode failed (b64Length={Len})", rawB64.Length);
                continue;
            }

            if (imageData.Length > MaxImageSizeBytes)
            {
                _logger.LogWarning("Skipping image from {User}: {Size} bytes exceeds limit", sender.Name, imageData.Length);
                continue;
            }

            var ext = MimeToExtension.GetValueOrDefault(mimetype, "png");
            var fileName = $"image.{ext}";

            try
            {
                var mxcUrl = await _appService.UploadMedia(imageData, mimetype, fileName);
                await _appService.SendImageMessage(roomId, sender.Name, mxcUrl, fileName, mimetype, imageData.Length);
                remaining = remaining.Remove(match.Index - offset, match.Length);
                offset += match.Length;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to upload/send image from {User}", sender.Name);
            }
        }

        // Send remaining text if any
        var plainText = StripHtml(remaining);
        if (!string.IsNullOrWhiteSpace(plainText))
        {
            _logger.LogInformation("Relaying message from {User} in channel {ChannelId} to {RoomId}", sender.Name, channelId, roomId);
            await _appService.SendMessage(roomId, sender.Name, plainText);
        }
    }

    public async Task EnsureChannelRoom(MumbleChannel channel)
    {
        if (await _channelRepository.GetRoomIdAsync(channel.Id) is not null)
            return;

        _logger.LogInformation("Creating Matrix room for Mumble channel {Name} (id={Id})", channel.Name, channel.Id);
        var roomId = await _appService.CreateRoom(channel.Name);
        await _channelRepository.InsertAsync(channel.Id, roomId);
        _logger.LogInformation("Created Matrix room {RoomId} for channel {Name}", roomId, channel.Name);
    }

    public async Task DeleteChannelRoomAsync(int channelId)
    {
        await _channelRepository.DeleteAsync(channelId);
    }

    public async Task RenameChannelRoom(MumbleChannel channel)
    {
        var roomId = await _channelRepository.GetRoomIdAsync(channel.Id);
        if (roomId is null)
            return;
        await _appService.SetRoomName(roomId, channel.Name);
    }

    private static string StripHtml(string html)
    {
        var stripped = Regex.Replace(html, "<.*?>", string.Empty, RegexOptions.Singleline);
        return HttpUtility.HtmlDecode(stripped).Trim();
    }
}
