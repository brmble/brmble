using System.Text.Json;
using System.Text.Json.Serialization;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Security;
using Brmble.Client.Services.Serverlist;

namespace Brmble.Client.Services.AppConfig;

internal sealed class AppConfigService : IAppConfigService
{
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _configPath;
    private readonly string _legacyServersPath;
    private readonly string _dir;
    private List<ServerEntry> _servers = new();
    private AppSettings _settings = AppSettings.Default;
    private WindowState? _windowState;
    private string? _closePreference;
    private string? _lastConnectedServerId;
    private double? _zoomFactor;
    private List<ProfileEntry> _profiles = new();
    private string? _activeProfileId;
    private Dictionary<string, Dictionary<string, RegistrationInfo>> _profileRegistrations = new();
    private readonly string _certsDir;
    private readonly object _lock = new();
    private readonly ISecurePasswordStorage _passwordStorage;

    public string ServiceName => "appConfig";

    /// <summary>Optional callback invoked after settings are updated via SetSettings.</summary>
    public Action<AppSettings>? OnSettingsChanged { get; set; }

    public AppConfigService() : this(GetDefaultDir(), null) { }

    internal AppConfigService(string dir, ISecurePasswordStorage? passwordStorage)
    {
        _dir = dir;
        _configPath = Path.Combine(dir, "config.json");
        _legacyServersPath = Path.Combine(dir, "servers.json");
        _certsDir = Path.Combine(dir, "certs");
        _passwordStorage = passwordStorage ?? new SecurePasswordStorage();
        Directory.CreateDirectory(_certsDir);
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
            var entry = ParseServerEntry(data, _passwordStorage);
            if (entry != null)
            {
                AddServer(entry);
                bridge.Send("servers.added", new { server = entry });
            }
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("servers.update", async data =>
        {
            var entry = ParseServerEntry(data, _passwordStorage);
            if (entry != null)
            {
                var merged = UpdateServer(entry);
                if (merged != null)
                    bridge.Send("servers.updated", new { server = merged });
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

    public ServerEntry? UpdateServer(ServerEntry server)
    {
        lock (_lock)
        {
            var i = _servers.FindIndex(s => s.Id == server.Id);
            if (i >= 0)
            {
                // Replace the existing entry wholesale with the incoming server entry.
                // The frontend sends a full ServerEntry on edit, so this allows fields to be cleared.
                _servers[i] = server;
                Save();
                return _servers[i];
            }
            return null;
        }
    }

    public void RemoveServer(string id)
    {
        lock (_lock) { _servers.RemoveAll(s => s.Id == id); Save(); }
    }

    public void SwapProfileRegistrations(string? oldProfileId, string? newProfileId)
    {
        lock (_lock)
        {
            // Save current registrations under old profile
            if (!string.IsNullOrEmpty(oldProfileId))
            {
                var regs = new Dictionary<string, RegistrationInfo>();
                foreach (var s in _servers)
                {
                    if (s.Registered || s.RegisteredName != null)
                        regs[s.Id] = new RegistrationInfo(s.Registered, s.RegisteredName);
                }
                _profileRegistrations[oldProfileId!] = regs;
            }

            // Load new profile's cached registrations (or clear if none cached)
            Dictionary<string, RegistrationInfo>? newRegs = null;
            if (!string.IsNullOrEmpty(newProfileId))
                _profileRegistrations.TryGetValue(newProfileId!, out newRegs);

            for (int i = 0; i < _servers.Count; i++)
            {
                RegistrationInfo? info = null;
                if (newRegs != null && newRegs.TryGetValue(_servers[i].Id, out var found))
                    info = found;
                _servers[i] = _servers[i] with
                {
                    Registered = info?.Registered ?? false,
                    RegisteredName = info?.RegisteredName
                };
            }

            Save();
        }
    }

    public AppSettings GetSettings()
    {
        lock (_lock) return _settings;
    }

    public void SetSettings(AppSettings settings)
    {
        AppSettings capturedSettings;
        lock (_lock) { _settings = settings; Save(); capturedSettings = settings; }
        OnSettingsChanged?.Invoke(capturedSettings);
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

    public string? GetLastConnectedServerId()
    {
        lock (_lock) return _lastConnectedServerId;
    }

    public void SaveLastConnectedServerId(string? serverId)
    {
        lock (_lock) { _lastConnectedServerId = serverId; Save(); }
    }

    public double? GetZoomFactor()
    {
        lock (_lock) return _zoomFactor;
    }

    public void SaveZoomFactor(double? factor)
    {
        lock (_lock) { _zoomFactor = factor; Save(); }
    }

    public string GetCertsDir() => _certsDir;

    public IReadOnlyList<ProfileEntry> GetProfiles() { lock (_lock) return _profiles.ToList(); }

    public bool AddProfile(ProfileEntry profile)
    {
        lock (_lock)
        {
            if (_profiles.Any(p => p.Id == profile.Id)) return false;
            if (_profiles.Any(p => p.Name.Equals(profile.Name, StringComparison.OrdinalIgnoreCase))) return false;
            _profiles.Add(profile);
            Save();
            return true;
        }
    }

    public void RemoveProfile(string id)
    {
        lock (_lock)
        {
            _profiles.RemoveAll(p => p.Id == id);
            if (_activeProfileId == id)
                _activeProfileId = _profiles.FirstOrDefault()?.Id;
            Save();
        }
    }

    public bool RenameProfile(string id, string newName)
    {
        lock (_lock)
        {
            if (_profiles.Any(p => p.Id != id && p.Name.Equals(newName, StringComparison.OrdinalIgnoreCase))) return false;
            var idx = _profiles.FindIndex(p => p.Id == id);
            if (idx >= 0)
            {
                _profiles[idx] = _profiles[idx] with { Name = newName };
                Save();
                return true;
            }
            return false;
        }
    }

    public string? GetActiveProfileId() { lock (_lock) return _activeProfileId; }

    public void SetActiveProfileId(string? id)
    {
        lock (_lock)
        {
            if (id != null && !_profiles.Any(p => p.Id == id)) return;
            _activeProfileId = id;
            Save();
        }
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_configPath))
            {
                var json = File.ReadAllText(_configPath);
                var data = JsonSerializer.Deserialize<ConfigData>(json, _jsonOptions);
                _servers = (data?.Servers ?? new List<ServerEntry>())
                    .Select(s => s with { Password = TryDecryptPassword(s.Password, _passwordStorage) })
                    .ToList();
                _settings = data?.Settings ?? AppSettings.Default;
                _windowState = data?.Window;
                _closePreference = data?.ClosePreference;
                _lastConnectedServerId = data?.LastConnectedServerId;
                _zoomFactor = data?.ZoomFactor;
                _profiles = data?.Profiles ?? new List<ProfileEntry>();
                _activeProfileId = data?.ActiveProfileId;
                _profileRegistrations = data?.ProfileRegistrations ?? new();
                MigrateIdentityPfx();
                return;
            }

            // Migrate from legacy servers.json
            if (File.Exists(_legacyServersPath))
            {
                var json = File.ReadAllText(_legacyServersPath);
                var legacy = JsonSerializer.Deserialize<LegacyServerlistData>(json);
                _servers = (legacy?.Servers ?? new List<ServerEntry>())
                    .Select(s => s with { Password = TryDecryptPassword(s.Password, _passwordStorage) })
                    .ToList();
                Save(); // write config.json immediately
                MigrateIdentityPfx();
                return;
            }
        }
        catch
        {
            _servers = new List<ServerEntry>();
            _settings = AppSettings.Default;
            _windowState = null;
            _closePreference = null;
            _lastConnectedServerId = null;
            _zoomFactor = null;
            _profiles = new List<ProfileEntry>();
            _activeProfileId = null;
            _profileRegistrations = new();
        }

        MigrateIdentityPfx();
    }

    private void Save()
    {
        var encryptedServers = _servers.Select(s => s with
        {
            Password = string.IsNullOrEmpty(s.Password) || _passwordStorage.IsEncrypted(s.Password)
                ? s.Password
                : TryEncryptPassword(s.Password)
        }).ToList();

        var data = new ConfigData {
            Servers = encryptedServers, Settings = _settings, Window = _windowState,
            ClosePreference = _closePreference, LastConnectedServerId = _lastConnectedServerId,
            ZoomFactor = _zoomFactor, Profiles = _profiles, ActiveProfileId = _activeProfileId,
            ProfileRegistrations = _profileRegistrations
        };
        File.WriteAllText(_configPath, JsonSerializer.Serialize(data, _jsonOptions));
    }

    private string TryEncryptPassword(string password)
    {
        try
        {
            return _passwordStorage.Encrypt(password);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[AppConfigService] WARNING: Failed to encrypt password (storing plaintext): {ex.Message}");
            return password;
        }
    }

    private static string TryDecryptPassword(string password, ISecurePasswordStorage passwordStorage)
    {
        try
        {
            return passwordStorage.IsEncrypted(password) ? passwordStorage.Decrypt(password) : password;
        }
        catch
        {
            return password;
        }
    }

    private static ServerEntry? ParseServerEntry(System.Text.Json.JsonElement data, ISecurePasswordStorage passwordStorage)
    {
        if (!data.TryGetProperty("id", out var idEl))
            return null;

        var id = idEl.GetString();
        if (string.IsNullOrEmpty(id))
            return null;

        var label = data.TryGetProperty("label", out var labelEl) ? labelEl.GetString() ?? "" : "";
        var username = data.TryGetProperty("username", out var usernameEl) ? usernameEl.GetString() ?? "" : "";
        var apiUrl = data.TryGetProperty("apiUrl", out var apiEl) ? apiEl.GetString() : null;
        var passwordRaw = data.TryGetProperty("password", out var pwEl) ? pwEl.GetString() ?? "" : "";
        var password = TryDecryptPassword(passwordRaw, passwordStorage);
        var registered = data.TryGetProperty("registered", out var regEl) && regEl.ValueKind == System.Text.Json.JsonValueKind.True;
        var registeredName = data.TryGetProperty("registeredName", out var rnEl) ? rnEl.GetString() : null;

        return new ServerEntry(
            id!,
            label,
            apiUrl,
            data.TryGetProperty("host", out var hostEl) ? hostEl.GetString() : null,
            data.TryGetProperty("port", out var portEl) && portEl.ValueKind == System.Text.Json.JsonValueKind.Number ? portEl.GetInt32() : null,
            username,
            password,
            registered,
            registeredName);
    }

    private record ConfigData
    {
        public List<ServerEntry> Servers { get; init; } = [];
        public AppSettings Settings { get; init; } = AppSettings.Default;
        public WindowState? Window { get; init; } = null;
        public string? ClosePreference { get; init; } = null;
        public string? LastConnectedServerId { get; init; } = null;
        public double? ZoomFactor { get; init; } = null;
        public List<ProfileEntry> Profiles { get; init; } = [];
        public string? ActiveProfileId { get; init; } = null;
        public Dictionary<string, Dictionary<string, RegistrationInfo>> ProfileRegistrations { get; init; } = new();
    }

    private void MigrateIdentityPfx()
    {
        if (_profiles.Count > 0) return;

        var oldCertPath = Path.Combine(_dir, "identity.pfx");
        if (!File.Exists(oldCertPath)) return;

        var id = Guid.NewGuid().ToString();
        var profileName = "Default";
        var newCertPath = Path.Combine(_certsDir, SanitizeForFileName(profileName) + "_" + id + ".pfx");

        try
        {
            File.Move(oldCertPath, newCertPath);

            _profiles.Add(new ProfileEntry(id, "Default"));
            _activeProfileId = id;

            try
            {
                Save();
            }
            catch
            {
                // Save() failed — roll back the file move and profile state
                _profiles.RemoveAll(p => p.Id == id);
                _activeProfileId = null;
                File.Move(newCertPath, oldCertPath);
                return;
            }
        }
        catch
        {
            // File.Move or rollback failed — ensure profile state is clean
            _profiles.RemoveAll(p => p.Id == id);
            _activeProfileId = null;
        }
    }

    private record LegacyServerlistData
    {
        public List<ServerEntry> Servers { get; init; } = [];
    }

    private static string SanitizeForFileName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "profile";
        var invalid = new HashSet<char>(Path.GetInvalidFileNameChars());
        var sb = new System.Text.StringBuilder(name.Length);
        bool lastWasUnderscore = false;
        foreach (var c in name)
        {
            if (invalid.Contains(c) || c == ' ')
            {
                if (!lastWasUnderscore) { sb.Append('_'); lastWasUnderscore = true; }
            }
            else
            {
                sb.Append(c);
                lastWasUnderscore = false;
            }
        }
        var result = sb.ToString().Trim('_');
        if (result.Length > 50) result = result[..50].TrimEnd('_');
        return result.Length == 0 ? "profile" : result;
    }
}
