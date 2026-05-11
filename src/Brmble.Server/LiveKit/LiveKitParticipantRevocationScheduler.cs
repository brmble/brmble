namespace Brmble.Server.LiveKit;

public sealed class LiveKitParticipantRevocationScheduler : ILiveKitParticipantRevocationScheduler
{
    private static readonly TimeSpan[] DefaultRetryDelays = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10)];

    private readonly ILiveKitParticipantRemover _participantRemover;
    private readonly IReadOnlyList<TimeSpan> _retryDelays;
    private readonly ILogger<LiveKitParticipantRevocationScheduler> _logger;

    public LiveKitParticipantRevocationScheduler(
        ILiveKitParticipantRemover participantRemover,
        ILogger<LiveKitParticipantRevocationScheduler> logger,
        IReadOnlyList<TimeSpan>? retryDelays = null)
    {
        _participantRemover = participantRemover;
        _retryDelays = retryDelays ?? DefaultRetryDelays;
        _logger = logger;
    }

    public async Task RevokeParticipants(IReadOnlyList<LiveKitParticipantRecord> records)
    {
        if (records.Count == 0)
            return;

        var snapshot = records.ToArray();
        var removedAll = await RemoveParticipants(snapshot);

        foreach (var delay in _retryDelays)
        {
            if (delay == TimeSpan.Zero)
            {
                if (!removedAll)
                    removedAll = await RemoveParticipants(snapshot);
            }
            else
            {
                _ = RetryAfterDelay(snapshot, delay);
            }
        }
    }

    private async Task RetryAfterDelay(IReadOnlyList<LiveKitParticipantRecord> records, TimeSpan delay)
    {
        try
        {
            await Task.Delay(delay);
            await RemoveParticipants(records);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "LiveKit participant revocation retry failed");
        }
    }

    private async Task<bool> RemoveParticipants(IReadOnlyList<LiveKitParticipantRecord> records)
    {
        var removedAll = true;
        foreach (var record in records)
        {
            var removed = await _participantRemover.RemoveParticipant(record.RoomName, record.MatrixUserId);
            removedAll &= removed;
        }

        return removedAll;
    }
}
