using System.Reflection;

namespace Brmble.Server.ServerInfo;

public interface IServerVersionProvider
{
    string Version { get; }
}

public sealed class ServerVersionProvider : IServerVersionProvider
{
    public string Version { get; } = ReadVersion();

    internal static string FormatVersion(string version, string? sourceRevisionId)
    {
        var releaseMatch = System.Text.RegularExpressions.Regex.Match(version, @"^(\d+\.\d+\.\d+)(?:\+[0-9a-f]{7,40})?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (releaseMatch.Success)
        {
            return releaseMatch.Groups[1].Value;
        }

        if (System.Text.RegularExpressions.Regex.IsMatch(version, @"^0\.0\.0(?:[-+]|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            && string.IsNullOrWhiteSpace(sourceRevisionId)
            && !System.Text.RegularExpressions.Regex.IsMatch(version, @"\+[0-9a-f]{7,40}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        {
            return "Dev main";
        }

        var sha = sourceRevisionId;
        if (string.IsNullOrWhiteSpace(sha))
        {
            var match = System.Text.RegularExpressions.Regex.Match(version, @"\+([0-9a-f]{7,40})$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            sha = match.Success ? match.Groups[1].Value : null;
        }

        return string.IsNullOrWhiteSpace(sha)
            ? version
            : $"Dev main {sha[..Math.Min(7, sha.Length)]}";
    }

    private static string ReadVersion()
    {
        var informational = typeof(ServerVersionProvider).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informational))
        {
            return FormatVersion(informational, null);
        }

        var fileVersion = typeof(ServerVersionProvider).Assembly
            .GetName()
            .Version?
            .ToString(3);

        return !string.IsNullOrWhiteSpace(fileVersion) ? fileVersion : "0.0.0-dev";
    }
}
