# Brmble

## Running the Client

The client auto-detects whether to use the Vite dev server or local files:

### Development (hot reload)
```bash
cd src/Brmble.Web && npm run dev
# then in another terminal:
dotnet run --project src/Brmble.Client
```

### Production (local files)
```bash
cd src/Brmble.Web && npm run build
dotnet run --project src/Brmble.Client
```

The MSBuild target `CopyWebDist` copies `src/Brmble.Web/dist/` to the output `web/` folder on every build.

## Architecture Notes

- Brmble.Client is a raw Win32 + WebView2 app (no WPF/WinForms). There is no SynchronizationContext, so any non-WebView2 `await` in `InitWebView2Async` will break thread affinity and cause `Navigate()` to silently fail. Keep all non-WebView2 async work outside that method (e.g. synchronous calls in `Main`).

- **Single instance:** `Main` holds a named mutex (`Local\Brmble.SingleInstance`). A second launch focuses the running window (`FindWindow` on class `BrmbleWindow`) and exits. To run a second copy anyway — e.g. a dev build next to an installed one — pass `--allow-multiple` (`dotnet run --project src/Brmble.Client -- --allow-multiple`) or set env `BRMBLE_ALLOW_MULTIPLE=1`.

## Bridge Architecture

The client uses a modular C# ↔ JavaScript bridge:

### Structure
```
src/Brmble.Client/
├── Bridge/
│   ├── NativeBridge.cs    # C# ↔ JS transport (WebView2)
│   └── IService.cs        # Interface for backend services
└── Services/
    └── Voice/
        ├── VoiceService.cs    # Voice service interface
        └── MumbleAdapter.cs  # Mumble implementation
```

### Message Protocol
Messages use service-prefixed namespacing:
- `voice.connect` / `voice.connected`
- `voice.joinChannel` / `voice.channelJoined`
- `voice.userJoined` / `voice.userLeft`
- `voice.message` / `voice.error`

### Adding New Services
1. Create service interface in `Services/<ServiceName>/`
2. Implement IService interface
3. Register in Program.cs

### UI Thread Safety
NativeBridge marshals all calls to the UI thread via PostMessage(WM_USER) to prevent WebView2 freezes.

## Branch Management Rules

**IMPORTANT: AI agents must NEVER commit directly to main branch.**

### For All Changes:
1. **Always create a new branch** for any feature, fix, or change — do this automatically
2. **Commit changes** to the new branch
3. **Ask the user** before pushing the branch or creating a PR — never do this automatically

### Branch Naming Conventions:
- `feature/<feature-name>` - New features
- `fix/<issue-name>` - Bug fixes
- `docs/<topic>` - Documentation changes

### Example Workflow:
```bash
# Create and switch to new branch
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "feat: add my feature"

# Push and create PR
git push -u origin feature/my-feature
# Then create PR via GitHub UI or: gh pr create
```

### Never Do:
- ❌ Commit directly to main
- ❌ Push to main
- ❌ Merge PRs without review

## Tech Stack (Summary)
- Frontend: React + TypeScript + Vite
- Backend: ASP.NET Core
- Client: C# + WebView2
- Voice: MumbleSharp
- Text: Matrix (via Continuwity)

## UI Development

Before creating, modifying, styling, or reviewing any UI, read `docs/UI_GUIDE.md`, especially the AI Agent UI Gate.

Do not add new UI elements, components, settings, icons, notifications, modals, dialogs, prompts, confirmations, forms, inputs, selects, context menus, sidebar sections, user/channel rows, screen share UI, help text, empty/loading/error states, layout patterns, or CSS before checking the guide for the existing pattern.

Never hardcode colors, font sizes, font families, spacing, border radius, shadows, or transition values in UI code. Use existing CSS custom property tokens and theme variables. See `docs/UI_GUIDE.md` and `src/Brmble.Web/src/themes/_template.css`.

Do not create toast systems or toast components. Brmble uses top-right `<Notification>` with `useNotificationQueue`; repeatable informational notifications may need optional notification settings.

`docs/UI_GUIDE.md` is the source of truth for:
- Design tokens and theme compatibility
- Component patterns
- Modals, dialogs, prompts, and confirmations
- Settings tab layout and `SettingsHelp`
- Icon usage
- Notification behavior and optionality

If the guide does not cover the UI pattern you need, update `docs/UI_GUIDE.md` in the same branch before or alongside the UI change.

## Running Docker (local dev)

Docker runs natively via Rancher Desktop. No WSL prefix needed:
```bash
docker compose -f docker-local/docker-compose.yml up -d --build brmble
docker compose -f docker-local/docker-compose.yml logs -f brmble
```

## Build & Test (repeatable commands)
- Build all: dotnet build
- Build frontend: (cd src/Brmble.Web && npm run build)
- Run tests: dotnet test
- Specific test: dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
- Server tests: dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj

## Releasing

Versioning is coupled: client and server always share the same version (SemVer). A git tag triggers the full release.

### Creating a Release
1. Tag the commit: `git tag v0.1.0 && git push origin v0.1.0`
2. GitHub Actions (`.github/workflows/release.yml`) automatically:
   - Builds the frontend (`npm run build`)
   - Publishes the client (`dotnet publish` self-contained win-x64)
   - Packs with Velopack (`vpk pack`) — creates installer, portable zip + delta packages
   - Uploads everything to a GitHub Release with auto-generated release notes
   - Builds and pushes `ghcr.io/brmble/brmble-server:{version}` + `:latest`

### Release Artifacts (per GitHub Release)
- `Brmble-win-Setup.exe` — NSIS installer (per-user, `%LocalAppData%/Brmble`)
- `Brmble-win-Portable.zip` — standalone zip
- `Brmble-{version}-full.nupkg` — Velopack update package
- `RELEASES` + metadata — Velopack delta update feed

### Auto-Update
- The client checks for updates at startup and every 4 hours
- Updates are downloaded in the background from GitHub Releases
- A notification appears in the UI: "Update available: vX.Y.Z" with Update/Later buttons
- Update logic lives in `src/Brmble.Client/Services/Update/UpdateService.cs`
- Portable builds skip update checks automatically (`IsInstalled` check)

### Local Build Test
```bash
cd src/Brmble.Web && npm run build
dotnet publish src/Brmble.Client/Brmble.Client.csproj -c Release -r win-x64 --self-contained -o publish
mkdir -p publish/web && cp -r src/Brmble.Web/dist/* publish/web/
vpk pack --packId Brmble --packVersion 0.1.0 --packDir publish --mainExe Brmble.Client.exe --packTitle "Brmble"
```
Requires: `dotnet tool install -g vpk`

## Commit conventions
- feat: new feature
- fix: bug fix
- docs: docs changes
- refactor: code structure changes
- test: tests
