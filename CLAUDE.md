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
1. **Create a new branch** for any feature, fix, or change
2. **Commit changes** to the new branch
3. **Push the branch** to origin
4. **Create a PR** for code review

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

## Extra: Design for Multi-Agent Collaboration

This project supports modular bridge architecture. The following guidelines help AI agents collaborate:
- Never commit to main; create feature branches and PRs
- Use a consistent, explicit planning and review workflow

## Tech Stack (Summary)
- Frontend: React + TypeScript + Vite
- Backend: ASP.NET Core
- Client: C# + WebView2
- Voice: MumbleSharp
- Text: Matrix (via Continuwity)

## Build & Test (repeatable commands)
- Build all: dotnet build
- Build frontend: (cd src/Brmble.Web && npm run build)
- Run tests: dotnet test
- Specific test: dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj

## Commit conventions
- feat: new feature
- fix: bug fix
- docs: docs changes
- refactor: code structure changes
- test: tests
