namespace Brmble.Server.ChannelRequests;

public sealed record ChannelRequestError(string Code, string Message, int StatusCode)
{
    public static readonly ChannelRequestError InvalidChannelName = new("invalid_channel_name", "Use 1-50 characters. Avoid slashes, control characters, and leading or trailing spaces.", StatusCodes.Status400BadRequest);
    public static readonly ChannelRequestError ReasonTooLong = new("reason_too_long", "Reason must be 400 characters or fewer.", StatusCodes.Status400BadRequest);
    public static readonly ChannelRequestError DuplicatePendingRequest = new("duplicate_pending_request", "You already have a pending request for this channel name.", StatusCodes.Status409Conflict);
    public static readonly ChannelRequestError ChannelNameConflict = new("channel_name_conflict", "A channel with this name already exists.", StatusCodes.Status409Conflict);
    public static readonly ChannelRequestError TooManyPendingRequests = new("too_many_pending_requests", "You have reached the pending request limit. Resolve an existing request before creating another.", StatusCodes.Status429TooManyRequests);
    public static readonly ChannelRequestError RequestNotFound = new("request_not_found", "Channel request not found.", StatusCodes.Status404NotFound);
    public static readonly ChannelRequestError RequestNotPending = new("request_not_pending", "This request has already been handled.", StatusCodes.Status409Conflict);
    public static readonly ChannelRequestError ApprovalSyncFailed = new("approval_sync_failed", "The voice channel could not be created or the request could not be finalized. Please retry.", StatusCodes.Status409Conflict);
}
