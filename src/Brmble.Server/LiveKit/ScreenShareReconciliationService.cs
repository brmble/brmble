using Brmble.Server.Events;

namespace Brmble.Server.LiveKit;

public interface ILiveKitRoomQuery
{
    Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName);
}

public interface IUserIdMapper
{
    string? GetMatrixUserId(long userId);
}

public class SessionMappingUserIdMapper : IUserIdMapper
{
    private readonly ISessionMappingService _sessionMapping;

    public SessionMappingUserIdMapper(ISessionMappingService sessionMapping)
    {
        _sessionMapping = sessionMapping;
    }

    public string? GetMatrixUserId(long userId)
    {
        var snapshot = _sessionMapping.GetSnapshot();
        foreach (var mapping in snapshot.Values)
        {
            if (mapping.UserId == userId)
                return mapping.MatrixUserId;
        }
        return null;
    }
}

public class ScreenShareReconciliationService : BackgroundService
{
    private static readonly TimeSpan ReconciliationInterval = TimeSpan.FromSeconds(30);

    private readonly ScreenShareTracker _tracker;
    private readonly ILiveKitRoomQuery _roomQuery;
    private readonly IUserIdMapper _userIdMapper;
    private readonly IBrmbleEventBus _eventBus;
    private readonly ILogger<ScreenShareReconciliationService> _logger;

    public ScreenShareReconciliationService(
        ScreenShareTracker tracker,
        ILiveKitRoomQuery roomQuery,
        IUserIdMapper userIdMapper,
        IBrmbleEventBus eventBus,
        ILogger<ScreenShareReconciliationService> logger)
    {
        _tracker = tracker;
        _roomQuery = roomQuery;
        _userIdMapper = userIdMapper;
        _eventBus = eventBus;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(ReconciliationInterval, stoppingToken);
                await ReconcileAsync();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Screen share reconciliation failed");
            }
        }
    }

    public async Task ReconcileAsync()
    {
        var allRooms = _tracker.GetAllRoomNames();

        foreach (var roomName in allRooms)
        {
            try
            {
                var shares = _tracker.GetActiveShares(roomName);
                if (shares.Count == 0) continue;

                var participants = await _roomQuery.ListParticipantIdentities(roomName);
                var participantSet = new HashSet<string>(participants);

                foreach (var share in shares)
                {
                    var matrixId = share.MatrixUserId ?? _userIdMapper.GetMatrixUserId(share.UserId);
                    if (matrixId is null || !participantSet.Contains(matrixId))
                    {
                        _logger.LogInformation("Removing stale share for user {UserId} in room {Room}", share.UserId, roomName);
                        _tracker.StopByUserId(roomName, share.UserId);
                        await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = share.UserId });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not reconcile room {Room} (LiveKit may be unavailable)", roomName);
            }
        }
    }
}
