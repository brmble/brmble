using System.Text.RegularExpressions;
using System.Web;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Matrix;

public class MatrixService
{
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

        var plainText = StripHtml(text);
        _logger.LogInformation("Relaying message from {User} in channel {ChannelId} to {RoomId}", sender.Name, channelId, roomId);
        await _appService.SendMessage(roomId, sender.Name, plainText);
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
