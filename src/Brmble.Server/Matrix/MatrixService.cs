using System.Text.RegularExpressions;
using System.Web;
using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixService
{
    private readonly ChannelRepository _channelRepository;
    private readonly IMatrixAppService _appService;
    private readonly IActiveBrmbleSessions _activeSessions;

    public MatrixService(
        ChannelRepository channelRepository,
        IMatrixAppService appService,
        IActiveBrmbleSessions activeSessions)
    {
        _channelRepository = channelRepository;
        _appService = appService;
        _activeSessions = activeSessions;
    }

    public async Task RelayMessage(MumbleUser sender, string text, int channelId)
    {
        if (_activeSessions.IsBrmbleClient(sender.CertHash))
            return;

        var roomId = _channelRepository.GetRoomId(channelId);
        if (roomId is null)
            return;

        var plainText = StripHtml(text);
        await _appService.SendMessage(roomId, sender.Name, plainText);
    }

    public async Task EnsureChannelRoom(MumbleChannel channel)
    {
        if (_channelRepository.GetRoomId(channel.Id) is not null)
            return;

        var roomId = await _appService.CreateRoom(channel.Name);
        _channelRepository.Insert(channel.Id, roomId);
    }

    public void DeleteChannelRoom(int channelId)
    {
        _channelRepository.Delete(channelId);
    }

    public async Task RenameChannelRoom(MumbleChannel channel)
    {
        var roomId = _channelRepository.GetRoomId(channel.Id);
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
