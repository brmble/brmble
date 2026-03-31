using System.Text.Json;
using Brmble.Client.Bridge;
using Microsoft.Data.Sqlite;

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

        bridge.RegisterHandler("mumble.detectServers", async _ =>
        {
            var servers = DetectMumbleServers();
            bridge.Send("mumble.detectedServers", new { servers });
            await Task.CompletedTask;
        });

        bridge.RegisterHandler("mumble.importServers", async data =>
        {
            if (!data.TryGetProperty("servers", out var serversEl)) return;
            var added = new List<ServerEntry>();
            foreach (var s in serversEl.EnumerateArray())
            {
                var label = s.TryGetProperty("label", out var lEl) ? lEl.GetString() ?? "" : "";
                var host  = s.TryGetProperty("host",  out var hEl) ? hEl.GetString() ?? "" : "";
                var port  = s.TryGetProperty("port",  out var pEl) && pEl.ValueKind == JsonValueKind.Number
                            ? (int?)pEl.GetInt32() : null;
                if (string.IsNullOrWhiteSpace(host)) continue;
                var entry = new ServerEntry(
                    Guid.NewGuid().ToString(),
                    string.IsNullOrEmpty(label) ? host : label,
                    null, // no Brmble API URL — plain Mumble server
                    host,
                    port,
                    ""    // password intentionally omitted for security
                );
                AddServer(entry);
                added.Add(entry);
            }
            bridge.Send("mumble.serversImported", new { servers = added });
            await Task.CompletedTask;
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

    public ServerEntry? UpdateServer(ServerEntry server)
    {
        lock (_lock)
        {
            var index = _servers.FindIndex(s => s.Id == server.Id);
            if (index >= 0)
            {
                // Preserve the existing password when the incoming update omits it.
                var merged = string.IsNullOrEmpty(server.Password)
                    ? server with { Password = _servers[index].Password }
                    : server;
                _servers[index] = merged;
                Save();
                return _servers[index];
            }
            return null;
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

    private List<object> DetectMumbleServers()
    {
        var result = new List<object>();
        try
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var dbPath = Path.Combine(localAppData, "Mumble", "Mumble", "mumble.sqlite");
            if (!File.Exists(dbPath)) return result;

            var connStr = new SqliteConnectionStringBuilder
            {
                DataSource = dbPath,
                Mode = SqliteOpenMode.ReadOnly,
            }.ToString();

            using var conn = new SqliteConnection(connStr);
            conn.Open();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT name, hostname, port, username FROM servers ORDER BY id";

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                result.Add(new
                {
                    label    = reader.IsDBNull(0) ? "" : reader.GetString(0),
                    host     = reader.IsDBNull(1) ? "" : reader.GetString(1),
                    port     = reader.IsDBNull(2) ? 64738 : reader.GetInt32(2),
                    username = reader.IsDBNull(3) ? "" : reader.GetString(3),
                });
            }
        }
        catch { /* db locked, missing, or corrupt — return empty */ }
        return result;
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
        if (!data.TryGetProperty("label", out var label))
        {
            return null;
        }

        var id = data.TryGetProperty("id", out var idEl)
            ? idEl.GetString()
            : Guid.NewGuid().ToString();

        var apiUrl = data.TryGetProperty("apiUrl", out var apiEl) ? apiEl.GetString() : null;
        var password = data.TryGetProperty("password", out var pwEl) ? pwEl.GetString() ?? "" : "";

        return new ServerEntry(
            id!,
            label.GetString() ?? "",
            apiUrl,
            data.TryGetProperty("host", out var hostEl) ? hostEl.GetString() : null,
            data.TryGetProperty("port", out var portEl) && portEl.ValueKind == JsonValueKind.Number ? portEl.GetInt32() : null,
            password
        );
    }

    private record ServerlistData { public List<ServerEntry> Servers { get; init; } = []; }
}
