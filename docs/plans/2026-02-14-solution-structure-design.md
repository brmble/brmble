# Solution & Project Structure Design

**Date:** 2026-02-14

---

## Goal

Scaffold the Brmble repository with a single .sln, all project files, shared build props, and a React+Vite frontend — so that everything compiles, runs independently, and is ready for feature work.

## Repository Layout

```
brmble/
├── Brmble.sln
├── Directory.Build.props
├── .gitignore
├── src/
│   ├── Brmble.Server/              # ASP.NET Core backend
│   │   └── Brmble.Server.csproj
│   ├── Brmble.Client/              # Raw Win32 desktop + WebView2
│   │   └── Brmble.Client.csproj
│   └── Brmble.Web/                 # React + Vite (npm, not in .sln)
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
├── lib/
│   ├── MumbleSharp/
│   └── MumbleVoiceEngine/
├── tests/
│   └── MumbleVoiceEngine.Tests/
└── docs/
```

## Shared Build Properties

`Directory.Build.props` at repo root sets `net10.0`, `Nullable=enable`, `ImplicitUsings=enable`. Individual projects inherit these and only declare project-specific properties.

## Project Reference Graph

```
Brmble.Server        (no lib references)
Brmble.Client        → MumbleSharp, MumbleVoiceEngine
MumbleVoiceEngine    → MumbleSharp
MumbleSharp          (standalone, stays netstandard2.1)
MumbleVoiceEngine.Tests → MumbleVoiceEngine
```

## Project Details

**Brmble.Server** — ASP.NET Core minimal API. NuGet: `Yarp.ReverseProxy`. Skeleton `Program.cs` with health check endpoint and YARP config stub.

**Brmble.Client** — `OutputType=WinExe`, TFM override to `net10.0-windows`. NuGet: `Microsoft.Web.WebView2`. P/Invoke Win32 window hosting `CoreWebView2Controller`. References MumbleSharp + MumbleVoiceEngine.

**Brmble.Web** — `npm create vite` with React + TypeScript. No additional libraries yet. Separate from the .sln.

**MumbleVoiceEngine** — Remove duplicated TFM/nullable/usings props (inherited from root). Keep `AllowUnsafeBlocks`, NuGet refs, native DLLs. Add `ProjectReference` to MumbleSharp.

**MumbleSharp** — Unchanged. Stays at `netstandard2.1`.

## Success Criteria

1. `dotnet build Brmble.sln` — all 5 C# projects compile
2. `dotnet run --project src/Brmble.Server` — Kestrel starts, `GET /health` returns 200
3. `dotnet run --project src/Brmble.Client` — Win32 window opens with WebView2
4. `cd src/Brmble.Web && npm run dev` — Vite dev server starts
5. `dotnet test` — existing MumbleVoiceEngine tests pass

## Out of Scope

- Auth, Matrix/YARP proxy config, voice wiring, WebView2-C# bridge, Docker, shared DTOs
