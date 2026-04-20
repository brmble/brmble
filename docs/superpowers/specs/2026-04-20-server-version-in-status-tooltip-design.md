# Show Brmble Server Version in Service Status Tooltip

**Issue:** [#479](https://github.com/brmble/brmble/issues/479)
**Date:** 2026-04-20
**Status:** Design approved

## Problem

The sidebar "Server" service dot currently shows a tooltip like `Server: Connected` (or `Server: Connected — <error>`). Users have no way to see which server version they're talking to, making client/server version mismatches hard to spot.

## Goal

Extend the Server service tooltip to include the running server version, e.g. `Server: Connected — v0.2.1`. If the version is unavailable (older server, parse failure, disconnected), fall back to the current tooltip unchanged.

## Non-Goals

- Client version display in the UI (separate issue).
- Version information for Matrix, LiveKit, or Mumble-server services (separate issue).
- UI other than the Server dot tooltip.

## Architecture

The existing data flow for the Server service dot:

1. **Client (C#) `MumbleAdapter.StartHealthCheck`** polls `GET /health` every 30s on the connected Brmble server.
2. On success, it sends a `server.healthStatus` bridge message to the frontend.
3. **Frontend `useServerHealth`** listens for `server.healthStatus` and calls `updateStatus('server', …)` on the service-status store.
4. **`Sidebar.tsx` `dotTooltip('server')`** formats the tooltip from the stored state.

We extend each step to carry an optional `version` string, end-to-end.

## Components

### 1. Server: MinVer integration

- Add `<PackageReference Include="MinVer" Version="5.*" PrivateAssets="all" />` to `src/Brmble.Server/Brmble.Server.csproj`.
- Add `<MinVerTagPrefix>v</MinVerTagPrefix>` so git tags like `v0.2.1` map to version `0.2.1`.
- MinVer populates `AssemblyInformationalVersionAttribute` automatically during build:
  - Tagged commit `v0.2.1` → `0.2.1`
  - 4 commits past `v0.2.1` → `0.2.2-alpha.0.4+abc1234` (short SHA embedded)

### 2. Server: `IServerVersionProvider`

A minimal service that caches the version once at startup.

```
src/Brmble.Server/ServerInfo/ServerVersionProvider.cs
```

```csharp
public interface IServerVersionProvider { string Version { get; } }

public sealed class ServerVersionProvider : IServerVersionProvider
{
    public string Version { get; } =
        typeof(ServerVersionProvider).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "0.0.0-dev";
}
```

Registered in `Program.cs` as a singleton.

### 3. Server: `/health` response

`Program.cs`:

```csharp
app.MapGet("/health", (IServerVersionProvider v) =>
    Results.Ok(new { status = "healthy", version = v.Version }));
```

Backwards-compatible: clients that ignore the extra field keep working.

### 4. CI: `fetch-depth: 0`

`.github/workflows/release.yml` (the `actions/checkout` step) must use `fetch-depth: 0` so MinVer can read git history/tags. Any other workflows that build the server (`ci.yml`, `docker.yml` if present) get the same change.

### 5. Client (C#): parse version from `/health`

`src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, in `StartHealthCheck` inside the success branch:

- Read `res.Content.ReadAsStringAsync()`.
- Parse JSON (System.Text.Json). Extract optional `version` string property.
- On any parse failure or missing field, `version = null`.
- Send: `_bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl, version = parsedVersion });`

`state = "connecting"` and `state = "disconnected"` paths are unchanged (no version).

### 6. Frontend: types

`src/Brmble.Web/src/types/index.ts`, in `ServiceStatus`:

```ts
export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
  loss?: number;
  version?: string; // new, only set for 'server'
}
```

### 7. Frontend: `useServerHealth`

`src/Brmble.Web/src/hooks/useServerHealth.ts` — extend the `d` type and forward `version`:

```ts
const d = data as { state?: ServiceState; error?: string; label?: string; version?: string } | undefined;
if (!d?.state) return;
updateStatus('server', {
  state: d.state,
  error: d.error,
  label: d.label,
  version: d.version,
});
```

### 8. Frontend: `Sidebar.tsx` tooltip

`dotTooltip` in `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`:

When `svc === 'server'` and `statuses.server.version` is set, format the tooltip as:

```
Server: Connected — v0.2.1
```

or, if both version and error are present:

```
Server: Connected — v0.2.1 — <error>
```

If the version already starts with `v`, don't double-prefix. Otherwise the existing behaviour is preserved (no version field → current text).

## Data Flow

```
[git tag v0.2.1] --build--> [MinVer] --> [AssemblyInformationalVersion]
                                          |
                                          v
[Server startup] --> [IServerVersionProvider.Version = "0.2.1"]
                                          |
                                          v
GET /health -> { status: "healthy", version: "0.2.1" }
                                          |
                                          v
[Client MumbleAdapter health poll (every 30s)]
                                          |
                                          v
bridge.send("server.healthStatus", { state, label, version })
                                          |
                                          v
[Frontend useServerHealth] -> updateStatus('server', { ..., version })
                                          |
                                          v
[Sidebar.dotTooltip('server')] -> "Server: Connected — v0.2.1"
```

## Error Handling

| Failure mode | Result |
| --- | --- |
| `/health` returns non-200 | Existing disconnected flow, no version. |
| `/health` returns non-JSON or missing `version` | `version = null`; fallback tooltip. |
| Older server without version field | Works unchanged; fallback tooltip. |
| MinVer cannot read git (shallow clone, detached without tags) | `AssemblyInformationalVersion` defaults to `0.0.0-alpha.0.N+<sha>`. Tooltip shows that; still useful. Worst case the provider returns `"0.0.0-dev"`. |
| Client not yet connected to server | `server` dot is idle; no version. Unchanged behaviour. |

No new failure modes are introduced.

## Testing

- **`tests/Brmble.Server.Tests/HealthEndpointTests.cs`** (new): spin up the app with a stubbed `IServerVersionProvider` returning `"9.9.9"`, `GET /health`, assert JSON body `{ status: "healthy", version: "9.9.9" }`.
- **MinVer smoke check**: `dotnet build src/Brmble.Server` at a tagged commit locally produces the expected `AssemblyInformationalVersion` (manual verification during implementation).
- **Frontend**: no new test file; if an existing Sidebar / tooltip test covers the server dot, update it to assert the new format. If none exists, skip — don't create test infrastructure for a one-line format change.
- **Client C# `MumbleAdapter`**: not currently unit-tested; adding test infrastructure is out of scope. Manual verification by running the app against a local server.

## Release Considerations

- Older clients pointed at a newer server: ignore the extra JSON field. OK.
- Newer clients pointed at an older server: `version` missing → fallback tooltip. OK.
- Docker image builds: the Dockerfile must have `.git` available during the `dotnet publish` step for MinVer. If the existing Dockerfile copies only `src/`, this needs adjustment — to be verified during implementation and addressed in the plan if needed.

## Open Questions

None — design approved.
