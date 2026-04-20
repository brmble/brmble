using System.Reflection;

namespace Brmble.Server.ServerInfo;

public interface IServerVersionProvider
{
    string Version { get; }
}

public sealed class ServerVersionProvider : IServerVersionProvider
{
    public string Version { get; } = ReadVersion();

    private static string ReadVersion()
    {
        var informational = typeof(ServerVersionProvider).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informational))
        {
            return informational;
        }

        var fileVersion = typeof(ServerVersionProvider).Assembly
            .GetName()
            .Version?
            .ToString(3);

        return !string.IsNullOrWhiteSpace(fileVersion) ? fileVersion : "0.0.0-dev";
    }
}
