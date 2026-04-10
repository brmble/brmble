# Wizard Server Import Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark Mumble servers that are already saved in Brmble with an "Already saved" badge in the onboarding wizard's server import step, and pre-deselect them so re-importing is opt-in.

**Architecture:** The C# `mumble.detectServers` handler is enriched to compare detected Mumble servers against the current `servers.json` contents using host+port matching, adding an `alreadySaved` boolean to each entry in the response. The frontend reads this flag to pre-deselect matching cards and render a neutral "Already saved" badge instead of the blue "Import" badge.

**Tech Stack:** C# (.NET 8, `ServerlistService.cs`), React/TypeScript (`OnboardingWizard.tsx`), CSS custom properties

---

## Files

| File | Change |
|---|---|
| `src/Brmble.Client/Services/Serverlist/ServerlistService.cs` | Enrich `mumble.detectedServers` payload with `alreadySaved` |
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` | Add `alreadySaved` to `MumbleServer`, update pre-selection and badge render |
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css` | Add `.onboarding-identity-badge.saved` CSS rule |

---

### Task 1: Enrich `mumble.detectedServers` with `alreadySaved`

**Files:**
- Modify: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs:67-72` (handler) and `:146-181` (`DetectMumbleServers`)

The handler at line 67 currently calls `DetectMumbleServers()` and sends the result directly. We change `DetectMumbleServers()` to return a typed list so we can enrich it, then cross-reference against `GetServers()` in the handler.

- [ ] **Step 1: Change `DetectMumbleServers()` return type from `List<object>` to a named record**

Replace lines 146–181 in `ServerlistService.cs`. The current method returns `List<object>` with anonymous types. Change it to return `List<DetectedMumbleServer>` using a private record defined just above the method.

Add this record definition right before `DetectMumbleServers()` (after line 145, before line 146):

```csharp
private record DetectedMumbleServer(string Label, string Host, int Port, string Username, bool AlreadySaved = false);
```

Then replace the `DetectMumbleServers` method body (lines 146–181) with:

```csharp
private List<DetectedMumbleServer> DetectMumbleServers()
{
    var result = new List<DetectedMumbleServer>();
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
            result.Add(new DetectedMumbleServer(
                Label:    reader.IsDBNull(0) ? "" : reader.GetString(0),
                Host:     reader.IsDBNull(1) ? "" : reader.GetString(1),
                Port:     reader.IsDBNull(2) ? 64738 : reader.GetInt32(2),
                Username: reader.IsDBNull(3) ? "" : reader.GetString(3)
            ));
        }
    }
    catch { /* db locked, missing, or corrupt — return empty */ }
    return result;
}
```

- [ ] **Step 2: Enrich the handler with `alreadySaved` flags**

Replace lines 67–72 in `ServerlistService.cs` (the `mumble.detectServers` handler):

```csharp
bridge.RegisterHandler("mumble.detectServers", async _ =>
{
    var detected = DetectMumbleServers();
    var saved    = GetServers();

    // Build a set of "host:port" keys from already-saved servers (case-insensitive host)
    var savedKeys = new HashSet<string>(
        saved
            .Where(s => s.Host != null && s.Port != null)
            .Select(s => $"{s.Host!.ToLowerInvariant()}:{s.Port}"),
        StringComparer.Ordinal
    );

    // Enrich each detected server with alreadySaved flag
    var enriched = detected.Select(d => new
    {
        label       = d.Label,
        host        = d.Host,
        port        = d.Port,
        username    = d.Username,
        alreadySaved = savedKeys.Contains($"{d.Host.ToLowerInvariant()}:{d.Port}"),
    }).ToList();

    bridge.Send("mumble.detectedServers", new { servers = enriched });
    await Task.CompletedTask;
});
```

- [ ] **Step 3: Verify build has no compile errors**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj 2>&1 | grep "error CS"
```

Expected: no output (zero `error CS` lines). MSB3027/MSB3021 file-copy errors are acceptable if the app is running.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Serverlist/ServerlistService.cs
git commit -m "feat: enrich mumble.detectedServers with alreadySaved flag"
```

---

### Task 2: Frontend — read `alreadySaved`, update pre-selection and badge

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx:134` (interface), `:174-179` (handler), `:800-802` (badge render)

- [ ] **Step 1: Add `alreadySaved` to `MumbleServer` interface**

At line 134, replace:

```typescript
interface MumbleServer { label: string; host: string; port: number; username: string; }
```

with:

```typescript
interface MumbleServer { label: string; host: string; port: number; username: string; alreadySaved: boolean; }
```

- [ ] **Step 2: Pre-deselect already-saved servers in `onDetectedServers` handler**

At lines 174–179, replace:

```typescript
const onDetectedServers = (data: unknown) => {
  const d = data as { servers?: MumbleServer[] } | undefined;
  const svrs = d?.servers ?? [];
  setMumbleServers(svrs);
  setSelectedServers(new Set(svrs.map((_, i) => i)));
};
```

with:

```typescript
const onDetectedServers = (data: unknown) => {
  const d = data as { servers?: MumbleServer[] } | undefined;
  const svrs = d?.servers ?? [];
  setMumbleServers(svrs);
  // Pre-select all servers except those already saved in Brmble
  setSelectedServers(new Set(svrs.reduce<number[]>((acc, srv, i) => {
    if (!srv.alreadySaved) acc.push(i);
    return acc;
  }, [])));
};
```

- [ ] **Step 3: Update card badge render**

At lines 800–802, replace:

```tsx
{selectedServers.has(i) && (
  <span className="onboarding-identity-badge brmble">Import</span>
)}
```

with:

```tsx
{srv.alreadySaved && !selectedServers.has(i)
  ? <span className="onboarding-identity-badge saved">Already saved</span>
  : selectedServers.has(i)
    ? <span className="onboarding-identity-badge brmble">Import</span>
    : null
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd src/Brmble.Web && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: pre-deselect already-saved servers and show Already saved badge"
```

---

### Task 3: CSS — add `.saved` badge variant

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css:166-169` (after `.mumble` variant)

- [ ] **Step 1: Add `.saved` badge variant**

After line 169 in `OnboardingWizard.css` (after the `.mumble` closing brace), insert:

```css
.onboarding-identity-badge.saved {
  background: var(--bg-subtle);
  color: var(--text-muted);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css
git commit -m "feat: add .onboarding-identity-badge.saved CSS variant"
```
