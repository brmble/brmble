# Per-Server Default Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to assign a certificate profile per saved server, so connecting to that server automatically switches the global active profile.

**Architecture:** Add `DefaultProfileId` to `ServerEntry`. On connect, the frontend checks for an override and calls `profiles.setActive` before `voice.connect`. The server edit form gets a profile dropdown (hidden when <2 profiles). Server list items show a profile badge when an override is set.

**Tech Stack:** C# (.NET), React + TypeScript, WebView2 bridge

**Spec:** `docs/superpowers/specs/2026-04-02-per-server-default-profile-design.md`

---

### Task 1: Add DefaultProfileId to ServerEntry (C#)

**Files:**
- Modify: `src/Brmble.Client/Services/Serverlist/IServerlistService.cs:2-12`

- [ ] **Step 1: Add the field to the ServerEntry record**

In `src/Brmble.Client/Services/Serverlist/IServerlistService.cs`, add `DefaultProfileId` as the last parameter with a default of `null`:

```csharp
public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Password = "",
    bool Registered = false,
    string? RegisteredName = null,
    string? DefaultProfileId = null
);
```

- [ ] **Step 2: Verify the project builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds. Since `DefaultProfileId` has a default value, no existing call sites break.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Serverlist/IServerlistService.cs
git commit -m "feat: add DefaultProfileId to ServerEntry record"
```

---

### Task 2: Clean up stale DefaultProfileId on profile removal

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs:273-281`
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`, inside the `AppConfigServiceTests` class:

```csharp
[TestMethod]
public void RemoveProfile_ClearsDefaultProfileId_OnServerEntries()
{
    var svc = new AppConfigService(_tempDir, null);
    svc.AddProfile(new ProfileEntry("p1", "Work"));
    svc.AddProfile(new ProfileEntry("p2", "Personal"));
    svc.SetActiveProfileId("p1");

    // Add two servers: one linked to p1, one with no override
    svc.AddServer(new ServerEntry("s1", "Work Server", null, "work.example.com", 64738, DefaultProfileId: "p1"));
    svc.AddServer(new ServerEntry("s2", "Gaming", null, "game.example.com", 64738));

    svc.RemoveProfile("p1");

    var servers = svc.GetServers();
    Assert.IsNull(servers.First(s => s.Id == "s1").DefaultProfileId,
        "DefaultProfileId should be cleared when the referenced profile is removed");
    Assert.IsNull(servers.First(s => s.Id == "s2").DefaultProfileId,
        "Server without override should remain null");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "RemoveProfile_ClearsDefaultProfileId_OnServerEntries"`
Expected: FAIL — the current `RemoveProfile` doesn't touch server entries.

- [ ] **Step 3: Implement the cleanup in RemoveProfile**

In `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`, modify the `RemoveProfile` method. The current code is:

```csharp
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
```

Change it to:

```csharp
public void RemoveProfile(string id)
{
    lock (_lock)
    {
        _profiles.RemoveAll(p => p.Id == id);
        if (_activeProfileId == id)
            _activeProfileId = _profiles.FirstOrDefault()?.Id;

        // Clear stale DefaultProfileId references on server entries
        for (int i = 0; i < _servers.Count; i++)
        {
            if (_servers[i].DefaultProfileId == id)
                _servers[i] = _servers[i] with { DefaultProfileId = null };
        }

        Save();
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "RemoveProfile_ClearsDefaultProfileId_OnServerEntries"`
Expected: PASS

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppConfigService.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: clear stale DefaultProfileId when profile is removed"
```

---

### Task 3: Add DefaultProfileId persistence round-trip test

**Files:**
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

- [ ] **Step 1: Write the test**

Add this test to `AppConfigServiceTests`:

```csharp
[TestMethod]
public void ServerEntry_DefaultProfileId_PersistsAcrossReload()
{
    var svc = new AppConfigService(_tempDir, null);
    svc.AddServer(new ServerEntry("s1", "Test", null, "example.com", 64738, DefaultProfileId: "profile-123"));

    // Reload from disk
    var svc2 = new AppConfigService(_tempDir, null);
    var server = svc2.GetServers().First(s => s.Id == "s1");

    Assert.AreEqual("profile-123", server.DefaultProfileId);
}
```

- [ ] **Step 2: Run the test**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ServerEntry_DefaultProfileId_PersistsAcrossReload"`
Expected: PASS — the JSON serializer handles the new field automatically since `ServerEntry` is a record with a default value.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "test: verify DefaultProfileId round-trips through config persistence"
```

---

### Task 4: Add defaultProfileId to frontend ServerEntry type

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useServerlist.ts:4-13`

- [ ] **Step 1: Add the field to the TypeScript interface**

In `src/Brmble.Web/src/hooks/useServerlist.ts`, add `defaultProfileId` to the `ServerEntry` interface:

```typescript
export interface ServerEntry {
  id: string;
  label: string;
  apiUrl?: string;
  host: string;
  port: number;
  password: string;
  registered?: boolean;
  registeredName?: string;
  defaultProfileId?: string;
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useServerlist.ts
git commit -m "feat: add defaultProfileId to frontend ServerEntry type"
```

---

### Task 5: Switch active profile on server connect

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:1336-1349`

The `handleServerConnect` function in `App.tsx` is called when a user clicks "Connect" on a server list entry. This is where we switch the active profile before connecting.

- [ ] **Step 1: Add the profile switch logic**

In `src/Brmble.Web/src/App.tsx`, find the `handleServerConnect` function (around line 1336):

```typescript
const handleServerConnect = (server: ServerEntry) => {
    setServerLabel(server.label || `${server.host}:${server.port}`);
    handleConnect({
      id: server.id,
      label: server.label,
      apiUrl: server.apiUrl,
      host: server.host,
      port: server.port,
      username: (server.registered ? server.registeredName : null) || activeProfileName || 'Brmble User',
      password: server.password || '',
      registered: server.registered,
      registeredName: server.registeredName,
    });
  };
```

Add the profile switch before `handleConnect`:

```typescript
const handleServerConnect = (server: ServerEntry) => {
    setServerLabel(server.label || `${server.host}:${server.port}`);

    // Switch to per-server profile override if set
    if (server.defaultProfileId) {
      bridge.send('profiles.setActive', { id: server.defaultProfileId });
    }

    handleConnect({
      id: server.id,
      label: server.label,
      apiUrl: server.apiUrl,
      host: server.host,
      port: server.port,
      username: (server.registered ? server.registeredName : null) || activeProfileName || 'Brmble User',
      password: server.password || '',
      registered: server.registered,
      registeredName: server.registeredName,
    });
  };
```

Note: `profiles.setActive` is handled synchronously on the backend (it calls `SetActiveProfileId` which is immediate). The `voice.connect` handler reads `ActiveCertPath` later when establishing the TLS connection, so the ordering is correct even though bridge messages are async — they're processed in order.

- [ ] **Step 2: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: switch active profile when connecting to server with override"
```

---

### Task 6: Add profile dropdown to server edit form

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.tsx`

- [ ] **Step 1: Add imports and profile hook**

In `src/Brmble.Web/src/components/ServerList/ServerList.tsx`, add the imports at the top:

```typescript
import { useProfiles } from '../../hooks/useProfiles';
import { Select } from '../Select/Select';
```

- [ ] **Step 2: Wire up the profiles hook and extend form state**

Inside the `ServerList` component function, add the profiles hook right after the existing `useServerlist()` call:

```typescript
const { profiles } = useProfiles();
```

Change the form state from:
```typescript
const [form, setForm] = useState({ label: '', host: '', port: '64738', password: '' });
```
to:
```typescript
const [form, setForm] = useState({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
```

- [ ] **Step 3: Update handleSubmit to include defaultProfileId**

In the `handleSubmit` function, change:

```typescript
const server = { ...form, port: parseInt(form.port) };
if (editing) {
  updateServer({ ...server, id: editing.id, registered: editing.registered, registeredName: editing.registeredName });
```

to:

```typescript
const server = { ...form, port: parseInt(form.port), defaultProfileId: form.defaultProfileId || undefined };
if (editing) {
  updateServer({ ...server, id: editing.id, registered: editing.registered, registeredName: editing.registeredName });
```

- [ ] **Step 4: Update handleEdit to load defaultProfileId**

In the `handleEdit` function, change:

```typescript
setForm({
  label: server.label,
  host: server.host,
  port: String(server.port),
  password: server.password || ''
});
```

to:

```typescript
setForm({
  label: server.label,
  host: server.host,
  port: String(server.port),
  password: server.password || '',
  defaultProfileId: server.defaultProfileId || ''
});
```

- [ ] **Step 5: Update handleCancel and Escape handler to reset defaultProfileId**

In `handleCancel`, change:
```typescript
setForm({ label: '', host: '', port: '64738', password: '' });
```
to:
```typescript
setForm({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
```

In the `handleKey` Escape handler (inside the `useEffect`), change:
```typescript
setForm({ label: '', host: '', port: '64738', password: '' });
```
to:
```typescript
setForm({ label: '', host: '', port: '64738', password: '', defaultProfileId: '' });
```

- [ ] **Step 6: Add the Select dropdown to the form JSX**

In the form JSX, add the profile dropdown after the registered username field (after the closing `)}` of the `{editing?.registered && (` block, around line 263), but still inside `<div className="server-list-form-fields">`:

```tsx
{profiles.length >= 2 && (
  <div className="server-list-profile-select">
    <Select
      value={form.defaultProfileId}
      onChange={(val) => setForm(f => ({ ...f, defaultProfileId: val }))}
      options={[
        { value: '', label: 'Use active profile' },
        ...profiles.map(p => ({ value: p.id, label: p.name }))
      ]}
    />
  </div>
)}
```

- [ ] **Step 7: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/ServerList/ServerList.tsx
git commit -m "feat: add profile dropdown to server edit form"
```

---

### Task 7: Add profile badge to server list items

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.tsx`
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.css`

- [ ] **Step 1: Add the badge JSX**

In `ServerList.tsx`, inside the server list item mapping (the `{servers.map((server, index) => (` block), add a badge between `<div className="server-list-info">` and `<div className="server-list-actions">`. Find:

```tsx
<div className="server-list-info">
  <span className="server-list-name">{server.label}</span>
  <span className="server-list-address">{server.host}:{server.port}</span>
</div>
  <div className="server-list-actions">
```

Replace with:

```tsx
<div className="server-list-info">
  <span className="server-list-name">{server.label}</span>
  <span className="server-list-address">{server.host}:{server.port}</span>
</div>
{profiles.length >= 2 && server.defaultProfileId && (() => {
  const profile = profiles.find(p => p.id === server.defaultProfileId);
  return profile ? (
    <span className="server-list-profile-badge">{profile.name}</span>
  ) : null;
})()}
  <div className="server-list-actions">
```

- [ ] **Step 2: Add the CSS for the badge and dropdown**

Add these styles to the end of `src/Brmble.Web/src/components/ServerList/ServerList.css`:

```css
.server-list-profile-badge {
  background: var(--accent-primary-ghost);
  border: 1px solid var(--accent-primary-dim);
  border-radius: var(--radius-full);
  padding: 2px var(--space-sm);
  color: var(--accent-primary);
  font-size: var(--text-xs);
  white-space: nowrap;
  flex-shrink: 0;
}

.server-list-profile-select {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-sm);
}
```

- [ ] **Step 3: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ServerList/ServerList.tsx src/Brmble.Web/src/components/ServerList/ServerList.css
git commit -m "feat: show profile badge on server list items with override"
```

---

### Task 8: Manual testing and final verification

- [ ] **Step 1: Build everything**

Run: `dotnet build`
Expected: Build succeeds.

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

- [ ] **Step 2: Run all backend tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: All tests pass.

- [ ] **Step 3: Manual test checklist**

Launch the app and verify:

1. **1 profile:** Server edit form does NOT show the profile dropdown. Server list items do NOT show badges.
2. **2+ profiles:** Server edit form shows the profile dropdown below the password field. Options are "Use active profile" + all profile names.
3. **Set override:** Edit a server, select a profile, save. The server list item shows a badge with the profile name.
4. **Clear override:** Edit the same server, select "Use active profile", save. The badge disappears.
5. **Connect with override:** Connect to a server with an override. The active profile switches automatically (check the profile dropdown in settings).
6. **Connect without override:** Connect to a server without an override. The active profile remains unchanged.
7. **Delete profile with override:** Delete a profile that's assigned to a server. The badge disappears, the server falls back to the active profile.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address manual testing issues"
```
