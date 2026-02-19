using Brmble.Server.Auth;

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
}
