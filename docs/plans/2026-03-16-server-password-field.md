# Server Password Field Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional password field to the server list add/edit form so saved servers can store and use passwords for authentication.

**Architecture:** Add `password` to the `ServerEntry` record (C#) and TypeScript interface, add a password input to the ServerList form, and pass the stored password when connecting.

**Tech Stack:** React + TypeScript (frontend), C# records (backend)

---

### Task 1: Add password to C# ServerEntry record

**Files:**
- Modify: `src/Brmble.Client/Services/Serverlist/IServerlistService.cs:3-10`
- Modify: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs:129-151`

**Step 1: Add Password field to ServerEntry record**

In `IServerlistService.cs`, add `Password` as an optional parameter with a default:

```csharp
public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Username,
    string Password = ""
);
```

**Step 2: Update ParseServerEntry to read password**

In `ServerlistService.cs`, update the `ParseServerEntry` method to extract `password`:

```csharp
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
    var password = data.TryGetProperty("password", out var pwEl) ? pwEl.GetString() ?? "" : "";

    return new ServerEntry(
        id!,
        label.GetString() ?? "",
        apiUrl,
        data.TryGetProperty("host", out var hostEl) ? hostEl.GetString() : null,
        data.TryGetProperty("port", out var portEl) && portEl.ValueKind == JsonValueKind.Number ? portEl.GetInt32() : null,
        username.GetString() ?? "",
        password
    );
}
```

**Step 3: Build to verify**

Run: `dotnet build`
Expected: Build succeeds (existing tests may need updates in next task)

**Step 4: Commit**

```
git add src/Brmble.Client/Services/Serverlist/
git commit -m "feat: add password field to ServerEntry record"
```

---

### Task 2: Fix existing tests for new ServerEntry parameter

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs:68,172`

**Step 1: Update ServerEntry constructor calls in tests**

Add the password parameter to existing test ServerEntry constructors. Since `Password` has a default value of `""`, no changes should be needed — but verify the build.

**Step 2: Run tests**

Run: `dotnet test`
Expected: All tests pass

**Step 3: Commit (if changes were needed)**

```
git commit -m "test: update tests for ServerEntry password field"
```

---

### Task 3: Add password to TypeScript ServerEntry interface

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useServerlist.ts:4-10`

**Step 1: Add password to ServerEntry interface**

```typescript
export interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
}
```

**Step 2: Build frontend to verify**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds (ServerList form will need updates next)

**Step 3: Commit**

```
git add src/Brmble.Web/src/hooks/useServerlist.ts
git commit -m "feat: add password to TypeScript ServerEntry interface"
```

---

### Task 4: Add password field to ServerList form

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.tsx:17,23,31,36-41,48,68,180-185`

**Step 1: Add password to form state**

Line 17, change:
```typescript
const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '' });
```
to:
```typescript
const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '', password: '' });
```

**Step 2: Update all form reset locations**

There are 3 places where form is reset to default — lines 31, 48, 68. Change each from:
```typescript
setForm({ label: '', host: '', port: '64738', username: '' });
```
to:
```typescript
setForm({ label: '', host: '', port: '64738', username: '', password: '' });
```

**Step 3: Update handleEdit to populate password**

Lines 36-41, change:
```typescript
setForm({
  label: server.label,
  host: server.host,
  port: String(server.port),
  username: server.username
});
```
to:
```typescript
setForm({
  label: server.label,
  host: server.host,
  port: String(server.port),
  username: server.username,
  password: server.password || ''
});
```

**Step 4: Add password input to the form**

After the Username input (line 185), add:
```tsx
<input
  className="brmble-input server-list-input"
  placeholder="Password (optional)"
  type="password"
  value={form.password}
  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
/>
```

**Step 5: Build frontend**

Run (from `src/Brmble.Web`): `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```
git add src/Brmble.Web/src/components/ServerList/ServerList.tsx
git commit -m "feat: add password input to server list form"
```

---

### Task 5: Pass stored password when connecting from server list

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:1015-1023`

**Step 1: Update handleServerConnect**

Change:
```typescript
const handleServerConnect = (server: ServerEntry) => {
  setServerLabel(server.label || `${server.host}:${server.port}`);
  handleConnect({
    host: server.host, 
    port: server.port, 
    username: server.username, 
    password: '' 
  });
};
```
to:
```typescript
const handleServerConnect = (server: ServerEntry) => {
  setServerLabel(server.label || `${server.host}:${server.port}`);
  handleConnect({
    host: server.host, 
    port: server.port, 
    username: server.username, 
    password: server.password || '' 
  });
};
```

**Step 2: Build full project**

Run: `dotnet build` and `npm run build` (from `src/Brmble.Web`)
Expected: Both succeed

**Step 3: Run all tests**

Run: `dotnet test`
Expected: All pass

**Step 4: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: pass stored password when connecting from server list"
```
