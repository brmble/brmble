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

    /// <summary>
    /// Returns true if <paramref name="status"/> is a valid filter value:
    /// null/empty (no filter), "all" (no filter), or one of the known statuses.
    /// Returns false for any other string so callers can return a 400.
    /// </summary>
    public static bool IsValidFilter(string? status) =>
        string.IsNullOrWhiteSpace(status)
        || string.Equals(status, "all", StringComparison.OrdinalIgnoreCase)
        || All.Contains(status, StringComparer.OrdinalIgnoreCase);
}
