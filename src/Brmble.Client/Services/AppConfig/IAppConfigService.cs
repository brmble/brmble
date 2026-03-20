using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

public record ProfileEntry(string Id, string Name);

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
    string? GetClosePreference();
    void SaveClosePreference(string? preference);
    string? GetLastConnectedServerId();
    void SaveLastConnectedServerId(string? serverId);
    double? GetZoomFactor();
    void SaveZoomFactor(double? factor);
    IReadOnlyList<ProfileEntry> GetProfiles();
    void AddProfile(ProfileEntry profile);
    void RemoveProfile(string id);
    void RenameProfile(string id, string newName);
    string? GetActiveProfileId();
    void SetActiveProfileId(string? id);
    string GetCertsDir();
}
