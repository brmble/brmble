namespace Brmble.Server.ChannelRequests;

public sealed record CreateChannelRequestDto(string ChannelName, string? Reason);
public sealed record DenyChannelRequestDto(string? Reason);

public sealed record ChannelRequestDto(
    long Id,
    string ChannelName,
    string? Reason,
    string Status,
    DateTime CreatedAtUtc,
    DateTime? HandledAtUtc,
    string? DecisionReason,
    string? RequesterDisplayName,
    string? HandledByDisplayName,
    string? LastApprovalError)
{
    public static ChannelRequestDto FromModel(ChannelRequest request) =>
        new(
            request.Id,
            request.RequestedChannelName,
            request.Reason,
            request.Status,
            request.CreatedAtUtc,
            request.HandledAtUtc,
            request.DecisionReason,
            request.RequesterDisplayName,
            request.HandledByDisplayName,
            request.LastApprovalError);
}

public sealed record ChannelRequestListResponse(IReadOnlyList<ChannelRequestDto> Items);
