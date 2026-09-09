# Task 2 Report: Lightweight Vite Startup Entry Point

## Result

Implemented the standalone Vite startup entry point for Brmble.

## Files changed

- `src/Brmble.Web/startup.html`
  - Added a standalone HTML entry with the `Brmble` title, root element, and `/src/startup-main.tsx` module script.
- `src/Brmble.Web/src/startup-main.tsx`
  - Added React StrictMode and `createRoot` bootstrap.
  - Imported the shared base styles, headings, all nine theme stylesheets, `applyTheme`, `ErrorBoundary`, and `StartupScreen` with its state type.
  - Mirrored the existing `brmble-settings` theme bootstrap with safe parsing so malformed settings do not block rendering.
  - Selects `error` only for the exact `?state=error` query value; all other values use `loading`.
  - Renders `StartupScreen` under `ErrorBoundary` labeled `StartupScreen`.
- `src/Brmble.Web/vite.config.ts`
  - Added `startup.html` to the Rollup inputs.
  - Left the existing `manualChunks` configuration unchanged.
- `.superpowers/sdd/task-2-report.md`
  - Added this report.

## Verification

### Build

Command:

```text
npm run build
```

Result: passed with exit code 0. Vite emitted all three HTML entries, including `dist/startup.html`.

### Startup bundle checks

- `dist/startup.html` exists: confirmed.
- `dist/startup.html` contains `matrix-sdk`: no.
- The emitted startup entry JavaScript contains `matrix-sdk`: no.

### Full web test suite

Command:

```text
npm test
```

Result: passed with exit code 0.

- Test files: 163 passed
- Tests: 2,023 passed

The suite emitted existing jsdom/runtime diagnostic output during some tests, but no tests failed.

## Scope

Only the Task 2 startup entry, Vite input configuration, and requested report were added or modified. An unrelated pre-existing untracked plan file was preserved and not included.
