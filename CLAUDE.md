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
