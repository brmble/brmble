namespace Brmble.Server.ChannelRequests;

public sealed record AuthenticatedChannelRequestUser(long UserId, string DisplayName);
public sealed record ChannelRequestResult(bool Success, ChannelRequest? Request, ChannelRequestError? Error);

public class ChannelRequestService
{
    public const int MaxPendingRequestsPerUser = 3;

    private readonly IChannelRequestRepository _repository;
    private readonly IChannelRequestMumbleService _mumbleService;

    // Serializes concurrent approve/deny operations on the same request id to
    // prevent a Mumble channel being created for a request that has already been
    // denied (or double-created by two simultaneous approvals).
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<long, SemaphoreSlim> _approvalLocks = new();

    public ChannelRequestService(IChannelRequestRepository repository, IChannelRequestMumbleService mumbleService)
    {
        _repository = repository;
        _mumbleService = mumbleService;
    }

    public async Task<ChannelRequestResult> CreateAsync(AuthenticatedChannelRequestUser user, string? channelName, string? reason)
    {
        var validation = ChannelRequestValidation.ValidateCreate(channelName, reason);
        if (!validation.IsValid)
        {
            return new(false, null, validation.Error);
        }

        if (await _mumbleService.ChannelNameExistsAsync(validation.NormalizedChannelName!))
        {
            return new(false, null, ChannelRequestError.ChannelNameConflict);
        }

        var createResult = await _repository.CreatePendingAsync(
            new CreateChannelRequestRecord(
                user.UserId,
                user.DisplayName,
                validation.ChannelName!,
                validation.NormalizedChannelName!,
                validation.Reason),
            MaxPendingRequestsPerUser);

        return createResult.Outcome switch
        {
            CreatePendingChannelRequestOutcome.Created => new(true, createResult.Request, null),
            CreatePendingChannelRequestOutcome.DuplicatePending => new(false, null, ChannelRequestError.DuplicatePendingRequest),
            CreatePendingChannelRequestOutcome.TooManyPending => new(false, null, ChannelRequestError.TooManyPendingRequests),
            _ => new(false, null, ChannelRequestError.ApprovalSyncFailed)
        };
    }

    public Task<IReadOnlyList<ChannelRequest>> ListMineAsync(long requesterUserId, string? status, int limit) =>
        _repository.ListMineAsync(requesterUserId, NormalizeStatus(status), Math.Clamp(limit, 1, 100));

    public Task<IReadOnlyList<ChannelRequest>> ListAdminAsync(string? status, int limit) =>
        _repository.ListAdminAsync(NormalizeStatus(status), Math.Clamp(limit, 1, 100));

    public async Task<ChannelRequestResult> ApproveAsync(long id, AuthenticatedChannelRequestUser adminUser)
    {
        var gate = _approvalLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            var request = await _repository.GetByIdAsync(id);
            if (request is null)
            {
                return new(false, null, ChannelRequestError.RequestNotFound);
            }

            if (!string.Equals(request.Status, ChannelRequestStatus.Pending, StringComparison.OrdinalIgnoreCase))
            {
                return new(false, null, ChannelRequestError.RequestNotPending);
            }

            try
            {
                var channel = await _mumbleService.FindChannelByNameAsync(request.NormalizedChannelName)
                    ?? await _mumbleService.CreateChannelAsync(request.RequestedChannelName);

                var marked = await _repository.TryMarkApprovedAsync(
                    request.Id,
                    adminUser.UserId,
                    adminUser.DisplayName,
                    channel.ChannelId,
                    channel.ChannelName);

                if (!marked)
                {
                    await _repository.TryRecordApprovalFailureAsync(request.Id, "Channel exists in Mumble but the request row could not be marked approved.");
                    var healed = await _repository.GetByIdAsync(request.Id);
                    return healed is not null && string.Equals(healed.Status, ChannelRequestStatus.Approved, StringComparison.OrdinalIgnoreCase)
                        ? new(true, healed, null)
                        : new(false, null, ChannelRequestError.ApprovalSyncFailed);
                }

                return new(true, await _repository.GetByIdAsync(request.Id), null);
            }
            catch (Exception ex)
            {
                await _repository.TryRecordApprovalFailureAsync(request.Id, ex.Message);
                return new(false, null, ChannelRequestError.ApprovalSyncFailed);
            }
        }
        finally
        {
            gate.Release();
            _approvalLocks.TryRemove(id, out _);
        }
    }

    public async Task<ChannelRequestResult> DenyAsync(long id, AuthenticatedChannelRequestUser adminUser, string? decisionReason)
    {
        var gate = _approvalLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            var request = await _repository.GetByIdAsync(id);
            if (request is null)
            {
                return new(false, null, ChannelRequestError.RequestNotFound);
            }

            if (!string.Equals(request.Status, ChannelRequestStatus.Pending, StringComparison.OrdinalIgnoreCase))
            {
                return new(false, null, ChannelRequestError.RequestNotPending);
            }

            var denied = await _repository.TryMarkDeniedAsync(id, adminUser.UserId, adminUser.DisplayName, NormalizeReason(decisionReason));
            return denied
                ? new(true, await _repository.GetByIdAsync(id), null)
                : new(false, null, ChannelRequestError.RequestNotPending);
        }
        finally
        {
            gate.Release();
            _approvalLocks.TryRemove(id, out _);
        }
    }

    private static string? NormalizeStatus(string? status) =>
        ChannelRequestStatus.IsValid(status)
            ? string.IsNullOrWhiteSpace(status) || string.Equals(status, "all", StringComparison.OrdinalIgnoreCase)
                ? null
                : status.Trim().ToLowerInvariant()
            : null;

    private static string? NormalizeReason(string? reason) =>
        string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
}
