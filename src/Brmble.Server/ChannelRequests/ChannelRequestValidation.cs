using System.Globalization;

namespace Brmble.Server.ChannelRequests;

public sealed record ChannelRequestValidationResult(
    bool IsValid,
    string? ChannelName,
    string? NormalizedChannelName,
    string? Reason,
    ChannelRequestError? Error);

public static class ChannelRequestValidation
{
    public const int MaxChannelNameLength = 50;
    public const int MaxReasonLength = 400;

    public static ChannelRequestValidationResult ValidateCreate(string? channelName, string? reason)
    {
        var trimmedName = channelName?.Trim();
        if (string.IsNullOrWhiteSpace(trimmedName) || trimmedName.Length > MaxChannelNameLength)
        {
            return new(false, null, null, null, ChannelRequestError.InvalidChannelName);
        }

        if (trimmedName.Contains('/') || trimmedName.Any(char.IsControl))
        {
            return new(false, null, null, null, ChannelRequestError.InvalidChannelName);
        }

        var trimmedReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (trimmedReason is { Length: > MaxReasonLength })
        {
            return new(false, null, null, null, ChannelRequestError.ReasonTooLong);
        }

        return new(
            true,
            trimmedName,
            trimmedName.ToLower(CultureInfo.InvariantCulture),
            trimmedReason,
            null);
    }
}
