using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

public record ProfileEntry(string Id, string Name);
public record RegistrationInfo(bool Registered, string? RegisteredName);

public interface IAppConfigService
{
    IReadOnlyList<ServerEntry> GetServers();
    void AddServer(ServerEntry server);
    ServerEntry? UpdateServer(ServerEntry server);
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
    bool AddProfile(ProfileEntry profile);
    void RemoveProfile(string id);
    bool RenameProfile(string id, string newName);
    string? GetActiveProfileId();
    void SetActiveProfileId(string? id);
    string GetCertsDir();
    void SwapProfileRegistrations(string? oldProfileId, string? newProfileId);
}
