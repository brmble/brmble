using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

public interface IAppConfigService
{
    IReadOnlyList<ServerEntry> GetServers();
    void AddServer(ServerEntry server);
    void UpdateServer(ServerEntry server);
    void RemoveServer(string id);
    AppSettings GetSettings();
    void SetSettings(AppSettings settings);
    WindowState? GetWindowState();
    void SaveWindowState(WindowState state);
}
