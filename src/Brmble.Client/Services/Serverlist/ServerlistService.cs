using System.Text.Json;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Serverlist;

internal sealed class ServerlistService : IServerlistService
{
    private readonly string _configPath;
    private List<ServerEntry> _servers = new();
    private readonly object _lock = new();

    public string ServiceName => "servers";

    public ServerlistService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var brmbleDir = Path.Combine(appData, "Brmble");
        Directory.CreateDirectory(brmbleDir);
        _configPath = Path.Combine(brmbleDir, "servers.json");
        Load();
    }

    public void Initialize(NativeBridge bridge) { }

    public void RegisterHandlers(NativeBridge bridge)
    {
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
        });

        bridge.RegisterHandler("servers.update", async data =>
        {
            var entry = ParseServerEntry(data);
            if (entry != null)
            {
                UpdateServer(entry);
                bridge.Send("servers.updated", new { server = entry });
            }
        });

        bridge.RegisterHandler("servers.remove", async data =>
        {
            if (data.TryGetProperty("id", out var idElement))
            {
                var id = idElement.GetString();
                if (!string.IsNullOrEmpty(id))
                {
                    RemoveServer(id);
                    bridge.Send("servers.removed", new { id });
                }
            }
        });
    }

    public IReadOnlyList<ServerEntry> GetServers()
    {
        lock (_lock)
        {
            return _servers.ToList();
        }
    }

    public void AddServer(ServerEntry server)
    {
        lock (_lock)
        {
            _servers.Add(server);
            Save();
        }
    }

    public void UpdateServer(ServerEntry server)
    {
        lock (_lock)
        {
            var index = _servers.FindIndex(s => s.Id == server.Id);
            if (index >= 0)
            {
                _servers[index] = server;
                Save();
            }
        }
    }

    public void RemoveServer(string id)
    {
        lock (_lock)
        {
            _servers.RemoveAll(s => s.Id == id);
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
                var data = JsonSerializer.Deserialize<ServerlistData>(json);
                _servers = data?.Servers ?? new List<ServerEntry>();
            }
        }
        catch
        {
            _servers = new List<ServerEntry>();
        }
    }

    private void Save()
    {
        var json = JsonSerializer.Serialize(new ServerlistData { Servers = _servers });
        File.WriteAllText(_configPath, json);
    }

    private static ServerEntry? ParseServerEntry(JsonElement data)
    {
        if (!data.TryGetProperty("label", out var label) ||
            !data.TryGetProperty("username", out var username))
        {
            return null;
        }

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
            username.GetString() ?? ""
        );
    }

    private record ServerlistData { public List<ServerEntry> Servers { get; init; } = []; }
}
