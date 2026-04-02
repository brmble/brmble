namespace Brmble.Client.Services.Serverlist;

public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Password = "",
    bool Registered = false,
    string? RegisteredName = null,
    string? DefaultProfileId = null
);

public interface IServerlistService
{
    string ServiceName { get; }
    void Initialize(Bridge.NativeBridge bridge);
    void RegisterHandlers(Bridge.NativeBridge bridge);
    IReadOnlyList<ServerEntry> GetServers();
    void AddServer(ServerEntry server);
    ServerEntry? UpdateServer(ServerEntry server);
    void RemoveServer(string id);
}
