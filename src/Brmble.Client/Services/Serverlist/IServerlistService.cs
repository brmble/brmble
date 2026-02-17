namespace Brmble.Client.Services.Serverlist;

public record ServerEntry(
    string Id,
    string Label,
    string Host,
    int Port,
    string Username
);

public interface IServerlistService
{
    string ServiceName { get; }
    void Initialize(Bridge.NativeBridge bridge);
    void RegisterHandlers(Bridge.NativeBridge bridge);
    IReadOnlyList<ServerEntry> GetServers();
    void AddServer(ServerEntry server);
    void UpdateServer(ServerEntry server);
    void RemoveServer(string id);
}
