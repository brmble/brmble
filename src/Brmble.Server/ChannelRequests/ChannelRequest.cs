namespace Brmble.Server.ChannelRequests;

public sealed record ChannelRequest(
    long Id,
    long RequesterUserId,
    string RequesterDisplayName,
    string RequestedChannelName,
    string NormalizedChannelName,
    string? Reason,
    string Status,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    DateTime? HandledAtUtc,
    long? HandledByUserId,
    string? HandledByDisplayName,
    string? DecisionReason,
    int? CreatedChannelId,
    string? CreatedChannelName,
    string? LastApprovalError,
    int ApprovalAttemptCount)
{
    public ChannelRequest()
        : this(0, 0, string.Empty, string.Empty, string.Empty, null, ChannelRequestStatus.Pending, DateTime.MinValue, DateTime.MinValue, null, null, null, null, null, null, null, 0)
    {
    }
}
