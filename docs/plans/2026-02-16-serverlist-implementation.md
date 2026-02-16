# Serverlist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add serverlist feature that allows users to save, manage, and connect to multiple Mumble servers with label, host, port, and username.

**Architecture:** C# service manages JSON file in %AppData%/Brmble/, exposed to React via NativeBridge using servers.* message types. Follows existing IService pattern used by VoiceService.

**Tech Stack:** C# (.NET), WebView2, React, JSON file storage

---

### Task 1: Create ServerlistService interface

**Files:**
- Create: `src/Brmble.Client/Services/Serverlist/IServerlistService.cs`

**Step 1: Write the interface**

```csharp
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
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Serverlist/IServerlistService.cs
git commit -m "feat(serverlist): add IServerlistService interface"
```

---

### Task 2: Create ServerlistService implementation

**Files:**
- Create: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs`

**Step 1: Write the implementation**

```csharp
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
            !data.TryGetProperty("host", out var host) ||
            !data.TryGetProperty("port", out var port) ||
            !data.TryGetProperty("username", out var username))
        {
            return null;
        }

        var id = data.TryGetProperty("id", out var idEl) 
            ? idEl.GetString() 
            : Guid.NewGuid().ToString();

        return new ServerEntry(
            id!,
            label.GetString() ?? "",
            host.GetString() ?? "",
            port.GetInt32(),
            username.GetString() ?? ""
        );
    }

    private record ServerlistData(List<ServerEntry> Servers);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Serverlist/ServerlistService.cs
git commit -m "feat(serverlist): add ServerlistService implementation"
```

---

### Task 3: Register ServerlistService in Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs:77-81`

**Step 1: Add service registration**

In Program.cs, after `_bridge = new NativeBridge(...)`, add:

```csharp
var serverlistService = new ServerlistService();
serverlistService.Initialize(_bridge);
serverlistService.RegisterHandlers(_bridge);
```

And update `SetupBridgeHandlers` to include:
```csharp
private static void SetupBridgeHandlers()
{
    _mumbleClient!.RegisterHandlers(_bridge);
    _serverlistService?.RegisterHandlers(_bridge);  // Add this line
}
```

Actually, simpler approach - just add the initialization after bridge creation:

```csharp
_bridge = new NativeBridge(_controller.CoreWebView2, hwnd);

var serverlistService = new ServerlistService();
serverlistService.Initialize(_bridge);
serverlistService.RegisterHandlers(_bridge);
            
_mumbleClient = new MumbleAdapter(_bridge);
```

**Step 2: Build to verify**

```bash
cd src/Brmble.Client && dotnet build
```

Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat(serverlist): register ServerlistService in Program.cs"
```

---

### Task 4: Create React serverlist hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useServerlist.ts`

**Step 1: Write the hook**

```typescript
import { useState, useEffect, useCallback } from 'react';

export interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
}

export function useServerlist() {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'servers.list') {
        setServers(msg.data.servers || []);
        setLoading(false);
      }
      if (msg.type === 'servers.added') {
        setServers(prev => [...prev, msg.data.server]);
      }
      if (msg.type === 'servers.updated') {
        setServers(prev => prev.map(s => 
          s.id === msg.data.server.id ? msg.data.server : s
        ));
      }
      if (msg.type === 'servers.removed') {
        setServers(prev => prev.filter(s => s.id !== msg.data.id));
      }
    };

    window.addEventListener('message', handleMessage);
    window.chrome.webview.postMessage({ type: 'servers.list' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const addServer = useCallback((server: Omit<ServerEntry, 'id'>) => {
    window.chrome.webview.postMessage({
      type: 'servers.add',
      data: { ...server, id: crypto.randomUUID() }
    });
  }, []);

  const updateServer = useCallback((server: ServerEntry) => {
    window.chrome.webview.postMessage({ type: 'servers.update', data: server });
  }, []);

  const removeServer = useCallback((id: string) => {
    window.chrome.webview.postMessage({ type: 'servers.remove', data: { id } });
  }, []);

  return { servers, loading, addServer, updateServer, removeServer };
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useServerlist.ts
git commit -m "feat(serverlist): add useServerlist React hook"
```

---

### Task 5: Create React ServerList component

**Files:**
- Create: `src/Brmble.Web/src/components/ServerList.tsx`

**Step 1: Write the component**

```tsx
import { useState } from 'react';
import { useServerlist, ServerEntry } from '../hooks/useServerlist';

export function ServerList({ onConnect }: { onConnect: (server: ServerEntry) => void }) {
  const { servers, loading, addServer, updateServer, removeServer } = useServerlist();
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '' });

  if (loading) return <div>Loading servers...</div>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const server = { ...form, port: parseInt(form.port) };
    if (editing) {
      updateServer({ ...server, id: editing.id });
      setEditing(null);
    } else {
      addServer(server);
      setIsAdding(false);
    }
    setForm({ label: '', host: '', port: '64738', username: '' });
  };

  return (
    <div className="server-list">
      <h2>Servers</h2>
      {servers.map(server => (
        <div key={server.id} className="server-item">
          <span>{server.label} - {server.host}:{server.port}</span>
          <div>
            <button onClick={() => onConnect(server)}>Connect</button>
            <button onClick={() => setEditing(server)}>Edit</button>
            <button onClick={() => removeServer(server.id)}>Delete</button>
          </div>
        </div>
      ))}
      
      {isAdding || editing ? (
        <form onSubmit={handleSubmit}>
          <input 
            placeholder="Label" 
            value={editing?.label ?? form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          />
          <input 
            placeholder="Host" 
            value={editing?.host ?? form.host}
            onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
          />
          <input 
            placeholder="Port" 
            type="number"
            value={editing?.port ?? form.port}
            onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
          />
          <input 
            placeholder="Username" 
            value={editing?.username ?? form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          />
          <button type="submit">{editing ? 'Update' : 'Add'}</button>
          <button type="button" onClick={() => { setEditing(null); setIsAdding(false); }}>
            Cancel
          </button>
        </form>
      ) : (
        <button onClick={() => setIsAdding(true)}>+ Add Server</button>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ServerList.tsx
git commit -m "feat(serverlist): add ServerList React component"
```

---

### Task 6: Integrate ServerList into existing UI

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (or main component)

**Step 1: Add ServerList component**

Add ServerList to the UI and connect the onConnect handler to voice.connect:

```tsx
import { ServerList } from './components/ServerList';
import { useVoice } from './hooks/useVoice';

function App() {
  const voice = useVoice();
  
  const handleConnect = (server: ServerEntry) => {
    voice.connect(server.host, server.port, server.username);
  };

  return (
    <div>
      <h1>Brmble</h1>
      <ServerList onConnect={handleConnect} />
      {/* existing voice UI */}
    </div>
  );
}
```

**Step 2: Build and test**

```bash
cd src/Brmble.Web && npm run build
cd src/Brmble.Client && dotnet build
```

Expected: Both build successfully

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(serverlist): integrate ServerList into main UI"
```

---

### Task 7: Final verification

**Step 1: Run full build**

```bash
dotnet build
cd src/Brmble.Web && npm run build
```

**Step 2: Verify with tests**

If tests exist:
```bash
dotnet test
```

**Step 3: Commit any final changes**

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | IServerlistService.cs | Interface definition |
| 2 | ServerlistService.cs | JSON file CRUD implementation |
| 3 | Program.cs | Register service in DI |
| 4 | useServerlist.ts | React hook for bridge communication |
| 5 | ServerList.tsx | React UI component |
| 6 | App.tsx | Integration |
| 7 | - | Final verification |

**Plan complete and saved to `docs/plans/2026-02-16-serverlist-implementation.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration
2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
