# Server Version in Status Tooltip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Brmble server's running version to the sidebar "Brmble" service-status tooltip (e.g. `Brmble: Connected — v0.2.1`), with graceful fallback when unavailable. Closes [#479](https://github.com/brmble/brmble/issues/479).

**Architecture:** MinVer derives an `AssemblyInformationalVersion` from git tags at build time. A singleton `IServerVersionProvider` exposes it, `/health` returns it alongside the existing `status` field, the C# client already-polling `/health` parses the version and forwards it through the existing `server.healthStatus` bridge event, and the frontend renders it into the existing `dotTooltip` for the `server` service.

**Tech Stack:** ASP.NET Core minimal API (net10.0), MinVer 5.x, MSTest + `Microsoft.AspNetCore.Mvc.Testing`, System.Text.Json, React + TypeScript (Vite), C# WebView2 host.

**Spec:** `docs/superpowers/specs/2026-04-20-server-version-in-status-tooltip-design.md`

---

## File Structure

| Path | Change |
| --- | --- |
| `src/Brmble.Server/Brmble.Server.csproj` | Modify — add MinVer package + `MinVerTagPrefix` |
| `src/Brmble.Server/ServerInfo/ServerVersionProvider.cs` | Create — `IServerVersionProvider` + impl |
| `src/Brmble.Server/Program.cs` | Modify — register provider, extend `/health` |
| `src/Brmble.Server/Dockerfile` | Modify — accept `ARG VERSION`, pass `-p:Version=${VERSION}` to publish |
| `.github/workflows/release.yml` | Modify — `fetch-depth: 0` on checkouts, pass `VERSION` build-arg to Docker |
| `tests/Brmble.Server.Tests/ServerInfo/ServerVersionProviderTests.cs` | Create — unit test for provider |
| `tests/Brmble.Server.Tests/Integration/HealthEndpointTests.cs` | Create — integration test for `/health` |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Modify — parse `version` from `/health` body, forward in `server.healthStatus` |
| `src/Brmble.Web/src/types/index.ts` | Modify — add optional `version?: string` to `ServiceStatus` |
| `src/Brmble.Web/src/hooks/useServerHealth.ts` | Modify — forward `version` to `updateStatus` |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` | Modify — include version in `dotTooltip('server')` |

---

## Task 1: MinVer + `ServerVersionProvider`

**Files:**
- Modify: `src/Brmble.Server/Brmble.Server.csproj`
- Create: `src/Brmble.Server/ServerInfo/ServerVersionProvider.cs`
- Create: `tests/Brmble.Server.Tests/ServerInfo/ServerVersionProviderTests.cs`

- [ ] **Step 1.1: Write the failing test**

Create `tests/Brmble.Server.Tests/ServerInfo/ServerVersionProviderTests.cs`:

```csharp
using Brmble.Server.ServerInfo;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.ServerInfo;

[TestClass]
public class ServerVersionProviderTests
{
    [TestMethod]
    public void Version_IsNonEmpty()
    {
        var provider = new ServerVersionProvider();
        Assert.IsFalse(string.IsNullOrWhiteSpace(provider.Version),
            "Version must be a non-empty string (MinVer or fallback).");
    }

    [TestMethod]
    public void Version_DoesNotStartWithV()
    {
        // MinVer output is SemVer without a 'v' prefix. The 'v' is applied
        // only in the frontend display. Keep the provider format stable.
        var provider = new ServerVersionProvider();
        Assert.IsFalse(provider.Version.StartsWith("v", StringComparison.OrdinalIgnoreCase),
            $"Version should be SemVer without 'v' prefix, got '{provider.Version}'.");
    }
}
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ServerVersionProviderTests`
Expected: FAIL — `ServerVersionProvider` does not exist.

- [ ] **Step 1.3: Add MinVer to server csproj**

Edit `src/Brmble.Server/Brmble.Server.csproj` — add a new `<PropertyGroup>` at the top and add the `MinVer` package in the existing `<ItemGroup>`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <MinVerTagPrefix>v</MinVerTagPrefix>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Dapper" Version="2.1.66" />
    <PackageReference Include="Livekit.Server.Sdk.Dotnet" Version="1.2.0" />
    <PackageReference Include="Microsoft.Data.Sqlite" Version="10.0.3" />
    <PackageReference Include="MinVer" Version="5.0.0" PrivateAssets="all" />
    <PackageReference Include="Yarp.ReverseProxy" Version="2.3.0" />
    <PackageReference Include="ZeroC.Ice" Version="3.8.0" />
    <PackageReference Include="ZeroC.Ice.Slice.Tools" Version="3.8.0">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>

</Project>
```

Note: the existing file starts directly with `<ItemGroup>`. Preserve everything that's already there; only add the new `<PropertyGroup>` block and the `MinVer` line.

- [ ] **Step 1.4: Create the provider**

Create `src/Brmble.Server/ServerInfo/ServerVersionProvider.cs`:

```csharp
using System.Reflection;

namespace Brmble.Server.ServerInfo;

public interface IServerVersionProvider
{
    string Version { get; }
}

public sealed class ServerVersionProvider : IServerVersionProvider
{
    public string Version { get; } = ReadVersion();

    private static string ReadVersion()
    {
        var informational = typeof(ServerVersionProvider).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informational))
        {
            return informational;
        }

        var fileVersion = typeof(ServerVersionProvider).Assembly
            .GetName()
            .Version?
            .ToString(3);

        return !string.IsNullOrWhiteSpace(fileVersion) ? fileVersion : "0.0.0-dev";
    }
}
```

- [ ] **Step 1.5: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ServerVersionProviderTests`
Expected: PASS (2 tests).

- [ ] **Step 1.6: Commit**

```bash
git add src/Brmble.Server/Brmble.Server.csproj \
        src/Brmble.Server/ServerInfo/ServerVersionProvider.cs \
        tests/Brmble.Server.Tests/ServerInfo/ServerVersionProviderTests.cs
git commit -m "feat(server): add MinVer + IServerVersionProvider (#479)"
```

---

## Task 2: Extend `/health` with `version`

**Files:**
- Create: `tests/Brmble.Server.Tests/Integration/HealthEndpointTests.cs`
- Modify: `src/Brmble.Server/Program.cs`

- [ ] **Step 2.1: Write the failing test**

Create `tests/Brmble.Server.Tests/Integration/HealthEndpointTests.cs`:

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class HealthEndpointTests
{
    [TestMethod]
    public async Task Health_ReturnsOk_WithStatusAndVersion()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");
        Assert.AreEqual(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        Assert.IsTrue(doc.RootElement.TryGetProperty("status", out var status));
        Assert.AreEqual("healthy", status.GetString());

        Assert.IsTrue(doc.RootElement.TryGetProperty("version", out var version),
            "Health response should include a 'version' field.");
        var v = version.GetString();
        Assert.IsFalse(string.IsNullOrWhiteSpace(v),
            "'version' should be a non-empty string.");
    }
}
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~HealthEndpointTests`
Expected: FAIL — response has no `version` field.

- [ ] **Step 2.3: Register provider + update endpoint**

Edit `src/Brmble.Server/Program.cs`:

1. In the service-registration block (just after `builder.Services.AddOptions<ServerInfoSettings>().BindConfiguration("ServerInfo");`), add:

```csharp
builder.Services.AddSingleton<IServerVersionProvider, ServerVersionProvider>();
```

2. Replace the existing line:

```csharp
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
```

with:

```csharp
app.MapGet("/health", (IServerVersionProvider version) =>
    Results.Ok(new { status = "healthy", version = version.Version }));
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~HealthEndpointTests`
Expected: PASS.

- [ ] **Step 2.5: Run the full server test suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all existing tests still pass (no regressions).

- [ ] **Step 2.6: Commit**

```bash
git add tests/Brmble.Server.Tests/Integration/HealthEndpointTests.cs \
        src/Brmble.Server/Program.cs
git commit -m "feat(server): expose version on /health (#479)"
```

---

## Task 3: CI + Dockerfile wire version through

MinVer reads git history during `dotnet publish`, but the Docker build copies only `src/Brmble.Server/` (no `.git`). We pass the tag version explicitly as a build-arg and let MinVer's `-p:Version=` override handle it. We also give `actions/checkout` full depth so non-Docker MinVer builds see tags.

**Files:**
- Modify: `src/Brmble.Server/Dockerfile`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 3.1: Accept `VERSION` in the Dockerfile**

Edit `src/Brmble.Server/Dockerfile`. In the `# ── Stage 2: Build Brmble.Server ─────` block, change it to:

```dockerfile
# ── Stage 2: Build Brmble.Server ─────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG VERSION=0.0.0-dev
WORKDIR /src

COPY Directory.Build.props .
COPY src/Brmble.Server/ src/Brmble.Server/

RUN dotnet publish src/Brmble.Server/Brmble.Server.csproj \
    -c Release \
    -r linux-x64 \
    --no-self-contained \
    -p:Version=${VERSION} \
    -o /app/publish
```

`-p:Version=…` sets the package version, which MinVer respects as an override — so `.git` is not required inside the build stage.

- [ ] **Step 3.2: Pass `VERSION` from the release workflow**

Edit `.github/workflows/release.yml`. Two changes:

(a) In the `client` job's `Checkout` step, add `fetch-depth: 0` so MinVer in other local/dev builds still works off this repo (no functional change to this job, but prevents future foot-guns):

```yaml
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
```

(b) In the `server` job, also set `fetch-depth: 0` and pass `VERSION` to the Docker build. Change the `server` job's `Checkout` step and the `Build and push` step:

```yaml
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Extract version from tag
        id: version
        shell: bash
        run: echo "version=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
```

Place the new `Extract version from tag` step immediately after `Checkout` and before `Log in to GitHub Container Registry`.

Then in the `Build and push` step, add `build-args`:

```yaml
      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          file: src/Brmble.Server/Dockerfile
          push: true
          build-args: |
            VERSION=${{ steps.version.outputs.version }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 3.3: Smoke-build the Docker image locally**

Run:

```bash
docker build --build-arg VERSION=0.99.0-test \
  -f src/Brmble.Server/Dockerfile \
  -t brmble-server:version-smoke .
```

Expected: build succeeds. Then run the image and check:

```bash
docker run --rm -d --name brmble-version-smoke -p 18080:8080 brmble-server:version-smoke
sleep 4
curl -sk https://localhost:18080/health
docker rm -f brmble-version-smoke
```

Expected JSON body: contains `"version":"0.99.0-test"`.

If the local Docker environment can't run the full supervisor stack for this smoke, skip this step and rely on the Task 2 integration test + Task 4 end-to-end check.

- [ ] **Step 3.4: Commit**

```bash
git add src/Brmble.Server/Dockerfile .github/workflows/release.yml
git commit -m "ci: pass tag version into server build for MinVer (#479)"
```

---

## Task 4: Client parses `version` from `/health`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (around lines 1304–1335 inside `StartHealthCheck`)

There is no existing unit-test infrastructure for `MumbleAdapter`, and standing it up is out of scope. Verification is manual at the end of Task 7. Keep the parse logic tiny and defensive.

- [ ] **Step 4.1: Replace the success branch of the health poll**

Locate `StartHealthCheck` in `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`. The current timer callback (abridged) reads:

```csharp
_healthTimer = new System.Threading.Timer(async _ =>
{
    if (Interlocked.Read(ref _healthGeneration) != gen) return;
    try
    {
        var res = await _healthHttpClient.GetAsync(url);
        if (Interlocked.Read(ref _healthGeneration) != gen) return;
        if (res.IsSuccessStatusCode)
            _bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl });
        else
            _bridge?.Send("server.healthStatus", new { state = "disconnected", error = $"Health check returned {(int)res.StatusCode}" });
    }
    catch (Exception ex)
    {
        if (Interlocked.Read(ref _healthGeneration) != gen) return;
        _bridge?.Send("server.healthStatus", new { state = "disconnected", error = ex.Message });
    }
    _bridge?.NotifyUiThread();
}, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
```

Replace it with:

```csharp
_healthTimer = new System.Threading.Timer(async _ =>
{
    if (Interlocked.Read(ref _healthGeneration) != gen) return;
    try
    {
        var res = await _healthHttpClient.GetAsync(url);
        if (Interlocked.Read(ref _healthGeneration) != gen) return;
        if (res.IsSuccessStatusCode)
        {
            var version = await TryReadVersionAsync(res);
            _bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl, version });
        }
        else
        {
            _bridge?.Send("server.healthStatus", new { state = "disconnected", error = $"Health check returned {(int)res.StatusCode}" });
        }
    }
    catch (Exception ex)
    {
        if (Interlocked.Read(ref _healthGeneration) != gen) return;
        _bridge?.Send("server.healthStatus", new { state = "disconnected", error = ex.Message });
    }
    _bridge?.NotifyUiThread();
}, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
```

- [ ] **Step 4.2: Add `TryReadVersionAsync` helper**

Add this private static method inside `MumbleAdapter` (place it directly below `StopHealthCheck`):

```csharp
private static async Task<string?> TryReadVersionAsync(HttpResponseMessage res)
{
    try
    {
        var body = await res.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("version", out var prop) &&
            prop.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            var v = prop.GetString();
            return string.IsNullOrWhiteSpace(v) ? null : v;
        }
    }
    catch
    {
        // Non-JSON, missing field, or transient parse failure — fall back to no version.
    }
    return null;
}
```

- [ ] **Step 4.3: Build the client**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: build succeeds with no new warnings.

- [ ] **Step 4.4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat(client): forward server version from /health poll (#479)"
```

---

## Task 5: Frontend type — optional `version`

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts` (around lines 67–73)

- [ ] **Step 5.1: Add `version` field**

Find:

```ts
export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
  loss?: number;
}
```

Replace with:

```ts
export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
  loss?: number;
  /** SemVer string for the connected Brmble server (only set for svc === 'server'). */
  version?: string;
}
```

- [ ] **Step 5.2: Type-check**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: succeeds (no type errors introduced).

- [ ] **Step 5.3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat(web): add optional version to ServiceStatus (#479)"
```

---

## Task 6: Frontend — forward version through `useServerHealth`

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useServerHealth.ts`

- [ ] **Step 6.1: Extend the bridge payload type and `updateStatus` call**

Replace the entire contents of `src/Brmble.Web/src/hooks/useServerHealth.ts` with:

```ts
import { useEffect } from 'react';
import bridge from '../bridge';
import { useServiceStatus } from './useServiceStatus';
import type { ServiceState } from '../types';

/**
 * Listens for server.healthStatus bridge messages from the C# backend,
 * which performs periodic health checks to avoid CORS issues with cross-origin fetches.
 */
export function useServerHealth() {
  const { updateStatus } = useServiceStatus();

  useEffect(() => {
    const onHealthStatus = (data: unknown) => {
      const d = data as {
        state?: ServiceState;
        error?: string;
        label?: string;
        version?: string;
      } | undefined;
      if (!d?.state) return;
      updateStatus('server', {
        state: d.state,
        error: d.error,
        label: d.label,
        version: d.version,
      });
    };

    bridge.on('server.healthStatus', onHealthStatus);
    return () => {
      bridge.off('server.healthStatus', onHealthStatus);
    };
  }, [updateStatus]);
}
```

- [ ] **Step 6.2: Run frontend tests**

Run: `(cd src/Brmble.Web && npm test -- --run)`
Expected: all existing tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useServerHealth.ts
git commit -m "feat(web): forward server version from health bridge event (#479)"
```

---

## Task 7: Frontend — show version in sidebar tooltip

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (the `dotTooltip` function, around lines 104–113)

- [ ] **Step 7.1: Update `dotTooltip`**

Find the current function:

```tsx
  const dotTooltip = (svc: ServiceName): string => {
    const name = SERVICE_DISPLAY_NAMES[svc];
    const state = stateLabel(statuses[svc].state);
    const error = statuses[svc].error;
    if (svc === 'voice' && statuses[svc].state === 'connected' && typeof statuses[svc].loss === 'number') {
      const quality = statuses[svc].loss < 2 ? ' (good)' : statuses[svc].loss < 10 ? ' (fair)' : ' (poor)';
      return `${name}: ${state}\nPacket loss: ${statuses[svc].loss}%${quality}`;
    }
    return error ? `${name}: ${state} — ${error}` : `${name}: ${state}`;
  };
```

Replace with:

```tsx
  const formatServerVersion = (v: string): string =>
    v.startsWith('v') || v.startsWith('V') ? v : `v${v}`;

  const dotTooltip = (svc: ServiceName): string => {
    const name = SERVICE_DISPLAY_NAMES[svc];
    const status = statuses[svc];
    const state = stateLabel(status.state);
    const error = status.error;

    if (svc === 'voice' && status.state === 'connected' && typeof status.loss === 'number') {
      const quality = status.loss < 2 ? ' (good)' : status.loss < 10 ? ' (fair)' : ' (poor)';
      return `${name}: ${state}\nPacket loss: ${status.loss}%${quality}`;
    }

    if (svc === 'server' && status.state === 'connected' && status.version) {
      const versionPart = formatServerVersion(status.version);
      return error
        ? `${name}: ${state} — ${versionPart} — ${error}`
        : `${name}: ${state} — ${versionPart}`;
    }

    return error ? `${name}: ${state} — ${error}` : `${name}: ${state}`;
  };
```

- [ ] **Step 7.2: Type-check + build**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: build succeeds.

- [ ] **Step 7.3: Run frontend tests**

Run: `(cd src/Brmble.Web && npm test -- --run)`
Expected: all existing tests pass.

- [ ] **Step 7.4: Manual end-to-end verification**

Run, in two terminals:

1. `(cd src/Brmble.Web && npm run dev)`
2. `dotnet run --project src/Brmble.Client`

Connect to a local Brmble server. Hover the "Brmble" service-status dot in the sidebar. Expected tooltip:

```
Brmble: Connected — v0.0.0-dev
```

(or whatever MinVer produced for the local checkout).

Then stop the server. The dot should flip to `disconnected` and the tooltip should fall back to `Brmble: Disconnected — <error>` (no version).

- [ ] **Step 7.5: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "feat(web): show server version in sidebar tooltip (#479)"
```

---

## Task 8: Final verification

- [ ] **Step 8.1: Run the full test matrix**

Run:

```bash
dotnet build
dotnet test
(cd src/Brmble.Web && npm run build && npm test -- --run)
```

Expected: all green.

- [ ] **Step 8.2: Confirm issue acceptance criteria**

Review the [spec](../specs/2026-04-20-server-version-in-status-tooltip-design.md) "Error Handling" table against the running system:

- Connected → version shown.
- Disconnected → no version; fallback tooltip.
- Older server (stub by temporarily editing `Program.cs` to omit the field, revert after) → fallback tooltip.

- [ ] **Step 8.3: Ask the user whether to open a PR**

Per project rules, do not push without explicit user approval.
