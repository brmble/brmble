using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

internal sealed class AppConfigService : IAppConfigService
{
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string _configPath;
    private readonly string _legacyServersPath;
    private List<ServerEntry> _servers = new();
    private AppSettings _settings = AppSettings.Default;
    private WindowState? _windowState;
    private string? _closePreference;
    private readonly object _lock = new();

    public string ServiceName => "appConfig";

    /// <summary>Optional callback invoked after settings are updated via SetSettings.</summary>
    public Action<AppSettings>? OnSettingsChanged { get; set; }

    public AppConfigService() : this(GetDefaultDir()) { }

    internal AppConfigService(string dir)
    {
        _configPath = Path.Combine(dir, "config.json");
        _legacyServersPath = Path.Combine(dir, "servers.json");
        Load();
    }

    private static string GetDefaultDir()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Brmble");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public void Initialize(NativeBridge bridge) { }

    public void RegisterHandlers(NativeBridge bridge)
    {
        // Server list handlers (unchanged API)
        bridge.RegisterHandler("servers.list", async _ =>
        {
            bridge.Send("servers.list", new { servers = GetServers() });
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.add", async data =>
        {
            var entry = ParseServerEntry(data);
            if (entry != null)
            {
                AddServer(entry);
                bridge.Send("servers.added", new { server = entry });
            }
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.update", async data =>
        {
            var entry = ParseServerEntry(data);
            if (entry != null)
            {
                UpdateServer(entry);
                bridge.Send("servers.updated", new { server = entry });
            }
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.remove", async data =>
        {
            if (data.TryGetProperty("id", out var idEl))
            {
                var id = idEl.GetString();
                if (!string.IsNullOrEmpty(id))
                {
                    RemoveServer(id);
                    bridge.Send("servers.removed", new { id });
                }
            }
            await Task.CompletedTask;
        });

        // Settings handlers
        bridge.RegisterHandler("settings.get", async _ =>
        {
            bridge.Send("settings.current", new { settings = GetSettings() });
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("settings.set", async data =>
        {
            if (data.TryGetProperty("settings", out var settingsEl))
            {
                var updated = JsonSerializer.Deserialize<AppSettings>(settingsEl.GetRawText(), _jsonOptions);
                if (updated != null)
                {
                    SetSettings(updated);
                    bridge.Send("settings.updated", new { settings = GetSettings() });
                }
            }
            await Task.CompletedTask;
        });
    }

    public IReadOnlyList<ServerEntry> GetServers()
    {
        lock (_lock) return _servers.ToList();
    }

    public void AddServer(ServerEntry server)
    {
        lock (_lock) { _servers.Add(server); Save(); }
    }

    public void UpdateServer(ServerEntry server)
    {
        lock (_lock)
        {
            var i = _servers.FindIndex(s => s.Id == server.Id);
            if (i >= 0) { _servers[i] = server; Save(); }
        }
    }

    public void RemoveServer(string id)
    {
        lock (_lock) { _servers.RemoveAll(s => s.Id == id); Save(); }
    }

    public AppSettings GetSettings()
    {
        lock (_lock) return _settings;
    }

    public void SetSettings(AppSettings settings)
    {
        lock (_lock) { _settings = settings; Save(); }
        OnSettingsChanged?.Invoke(settings);
    }

    public WindowState? GetWindowState()
    {
        lock (_lock) return _windowState;
    }

    public void SaveWindowState(WindowState state)
    {
        lock (_lock) { _windowState = state; Save(); }
    }

    public string? GetClosePreference()
    {
        lock (_lock) return _closePreference;
    }

    public void SaveClosePreference(string? preference)
    {
        lock (_lock) { _closePreference = preference; Save(); }
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_configPath))
            {
                var json = File.ReadAllText(_configPath);
                var data = JsonSerializer.Deserialize<ConfigData>(json, _jsonOptions);
                _servers = data?.Servers ?? new List<ServerEntry>();
                _settings = data?.Settings ?? AppSettings.Default;
                _windowState = data?.Window;
                _closePreference = data?.ClosePreference;
                return;
            }

            // Migrate from legacy servers.json
            if (File.Exists(_legacyServersPath))
            {
                var json = File.ReadAllText(_legacyServersPath);
                var legacy = JsonSerializer.Deserialize<LegacyServerlistData>(json);
                _servers = legacy?.Servers ?? new List<ServerEntry>();
                Save(); // write config.json immediately
                return;
            }
        }
        catch
        {
            _servers = new List<ServerEntry>();
            _settings = AppSettings.Default;
            _windowState = null;
            _closePreference = null;
        }
    }

    private void Save()
    {
        var data = new ConfigData { Servers = _servers, Settings = _settings, Window = _windowState, ClosePreference = _closePreference };
        File.WriteAllText(_configPath, JsonSerializer.Serialize(data, _jsonOptions));
    }

    private static ServerEntry? ParseServerEntry(System.Text.Json.JsonElement data)
    {
        if (!data.TryGetProperty("label", out var label) ||
            !data.TryGetProperty("username", out var username))
            return null;

        var id = data.TryGetProperty("id", out var idEl)
            ? idEl.GetString()
            : Guid.NewGuid().ToString();

        var apiUrl = data.TryGetProperty("apiUrl", out var apiEl) ? apiEl.GetString() : null;

        return new ServerEntry(
            id!,
            label.GetString() ?? "",
            apiUrl,
            data.TryGetProperty("host", out var hostEl) ? hostEl.GetString() : null,
            data.TryGetProperty("port", out var portEl) ? portEl.GetInt32() : null,
            username.GetString() ?? "");
    }

    private record ConfigData
    {
        public List<ServerEntry> Servers { get; init; } = [];
        public AppSettings Settings { get; init; } = AppSettings.Default;
        public WindowState? Window { get; init; } = null;
        public string? ClosePreference { get; init; } = null;
    }

    private record LegacyServerlistData
    {
        public List<ServerEntry> Servers { get; init; } = [];
    }
}
