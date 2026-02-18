using Brmble.Server.Auth;

namespace Brmble.Server.Matrix;

public class MatrixService
{
    private readonly ChannelRepository _channelRepository;
    private readonly MatrixAppService _appService;
    private readonly IActiveBrmbleSessions _activeSessions;

    public MatrixService(
        ChannelRepository channelRepository,
        MatrixAppService appService,
        IActiveBrmbleSessions activeSessions)
    {
        _channelRepository = channelRepository;
        _appService = appService;
        _activeSessions = activeSessions;
    }

    // TODO: RelayMessage(string senderName, string certHash, string text, int channelId)
    //   - If _activeSessions.IsBrmbleClient(certHash): return (skip — already dual-wrote)
    //   - roomId = _channelRepository.GetRoomId(channelId) ?? return (unmapped channel)
    //   - _appService.PostAsBot(roomId, $"[{senderName}]: {text}")
}
