# Close Dialog Design

**Date:** 2026-02-18  
**Feature:** Brmble-styled close dialog triggered by the window X button

## Summary

Replace the existing `ShowCloseDialog` Win32 fallback (ugly plain MessageBox) with a fully Brmble-styled modal overlay rendered inside the existing WebView2 instance.

## Approach

WebView2 React modal overlay. C# fires a bridge message (`window.showCloseDialog`) when the user clicks X; the React frontend shows a styled modal; the user's choice is sent back via bridge messages; C# acts on the result.

## Message Flow

```
User clicks X
  → WM_CLOSE in Program.cs WndProc
  → If _closeAction != null: execute stored action (minimize/quit) immediately
  → Else: _bridge.Send("window.showCloseDialog")  [fire-and-forget, return IntPtr.Zero]

React bridge.on('window.showCloseDialog')
  → setShowCloseDialog(true)

User clicks "Minimize" (+ optional "Don't ask again")
  → bridge.send('window.minimize')
  → if dontAskAgain: bridge.send('window.setClosePreference', { action: 'minimize' })

User clicks "Quit" (+ optional "Don't ask again")
  → bridge.send('window.quit')
  → if dontAskAgain: bridge.send('window.setClosePreference', { action: 'quit' })
```

## C# Changes

### `Program.cs`

- Replace `bool _skipCloseConfirmation` with `string? _closeAction` (null = ask, "minimize", or "quit")
- `WM_CLOSE` handler:
  - If `_closeAction == "minimize"`: `ShowWindow(SW_HIDE)`
  - If `_closeAction == "quit"`: `DestroyWindow(hwnd)`
  - Else: `_bridge.Send("window.showCloseDialog")` and return `IntPtr.Zero` (no blocking)
- Add `window.quit` bridge handler: calls `Win32Window.DestroyWindow(hwnd)`
- Update `window.setClosePreference` handler: reads `action` string instead of `skipConfirmation` bool
- Remove call to `Win32Window.ShowCloseDialog`

### `Win32Window.cs`

- Remove `ShowCloseDialog`, `ShowMessageBox`, `TaskDialogIndirect`, `TASKDIALOGCONFIG`, `TASKDIALOG_BUTTON` (all now unused)

## React Changes

### New: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.tsx`

```tsx
interface CloseDialogProps {
  isOpen: boolean;
  onMinimize: (dontAskAgain: boolean) => void;
  onQuit: (dontAskAgain: boolean) => void;
}
```

Visual design:
- Full-screen overlay: `rgba(15, 10, 20, 0.75)` background, backdrop-filter blur
- Centered card: `--bg-primary` background, `--border-subtle` border, berry glow box-shadow
- Title: `--font-display` (Cormorant Garamond), "Leaving so soon?"
- Subtitle: `--text-secondary`, "Choose what happens when you close the window."
- Two buttons:
  - **Minimize to tray** — primary berry accent style
  - **Quit** — danger/muted style, red on hover
- "Don't ask again" checkbox with muted label below buttons
- No X close button on the modal (must choose one action)

### New: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css`

Full Brmble styling using CSS vars from `index.css`.

### Modified: `src/Brmble.Web/src/App.tsx`

- Add `showCloseDialog: boolean` state
- Register `bridge.on('window.showCloseDialog', ...)` in the `useEffect`
- Add handlers `handleCloseMinimize` and `handleCloseQuit` that send bridge messages
- Render `<CloseDialog>` in the JSX

## "Don't Ask Again" Behavior

When checked, the preference is stored **session-only** in memory on the C# side via `_closeAction`. Future X clicks execute the stored action immediately without showing the dialog.

The `window.setClosePreference` bridge message payload changes from `{ skipConfirmation: bool }` to `{ action: 'minimize' | 'quit' }`.

## Files Affected

| File | Change |
|------|--------|
| `src/Brmble.Client/Program.cs` | Replace `_skipCloseConfirmation` with `_closeAction`, update WM_CLOSE, add `window.quit` handler, update `window.setClosePreference` |
| `src/Brmble.Client/Win32Window.cs` | Remove `ShowCloseDialog`, `ShowMessageBox`, TaskDialog P/Invokes |
| `src/Brmble.Web/src/components/CloseDialog/CloseDialog.tsx` | New file |
| `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css` | New file |
| `src/Brmble.Web/src/App.tsx` | Add state, bridge handler, and render CloseDialog |
