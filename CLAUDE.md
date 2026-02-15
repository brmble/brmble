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
