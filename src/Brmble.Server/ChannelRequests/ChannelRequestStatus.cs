namespace Brmble.Server.ChannelRequests;

public static class ChannelRequestStatus
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Denied = "denied";
    public static readonly string[] All = [Pending, Approved, Denied];
    public static readonly string SqlCheckConstraintList =
        string.Join(", ", All.Select(static status => $"'{status}'"));

    public static bool IsValid(string? status) =>
        string.IsNullOrWhiteSpace(status) || All.Contains(status, StringComparer.OrdinalIgnoreCase);
}
