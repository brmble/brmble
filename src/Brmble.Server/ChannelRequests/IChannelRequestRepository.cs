namespace Brmble.Server.ChannelRequests;

public sealed record CreateChannelRequestRecord(
    long RequesterUserId,
    string RequesterDisplayName,
    string RequestedChannelName,
    string NormalizedChannelName,
    string? Reason);

public enum CreatePendingChannelRequestOutcome
{
    Created,
    DuplicatePending,
    TooManyPending
}

public sealed record CreatePendingChannelRequestResult(
    CreatePendingChannelRequestOutcome Outcome,
    ChannelRequest? Request);

public interface IChannelRequestRepository
{
    Task<CreatePendingChannelRequestResult> CreatePendingAsync(CreateChannelRequestRecord record, int maxPendingRequestsPerUser);
    Task<IReadOnlyList<ChannelRequest>> ListMineAsync(long requesterUserId, string? status, int limit);
    Task<IReadOnlyList<ChannelRequest>> ListAdminAsync(string? status, int limit);
    Task<ChannelRequest?> GetByIdAsync(long id);
    Task<bool> TryMarkApprovedAsync(long id, long adminUserId, string adminDisplayName, int createdChannelId, string createdChannelName);
    Task<bool> TryMarkDeniedAsync(long id, long adminUserId, string adminDisplayName, string? decisionReason);
    Task<bool> TryRecordApprovalFailureAsync(long id, string errorMessage);
}
