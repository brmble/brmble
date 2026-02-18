# Close Dialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ugly Win32 MessageBox close dialog with a Brmble-styled React modal overlay triggered via the NativeBridge.

**Architecture:** C# sends `window.showCloseDialog` bridge message on WM_CLOSE (fire-and-forget). React shows a styled modal with "Minimize to tray" / "Quit" buttons and a "Don't ask again" checkbox. User's choice is posted back via `window.minimize`/`window.quit`/`window.setClosePreference` bridge messages. C# stores the preference as `_closeAction` (session-only, in memory).

**Tech Stack:** React 18 + TypeScript + Vite (frontend), C# + Win32 + WebView2 (backend), NativeBridge JSON messaging

---

### Task 1: Create the CloseDialog React component

**Files:**
- Create: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.tsx`
- Create: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css`

**Step 1: Create the CSS file**

Create `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css` with this content:

```css
.close-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 10, 20, 0.80);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: overlay-fade-in 150ms ease;
}

@keyframes overlay-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.close-dialog-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(212, 20, 90, 0.15),
    0 8px 32px rgba(15, 10, 20, 0.6),
    0 0 60px rgba(212, 20, 90, 0.08);
  padding: 40px 48px 32px;
  width: 380px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  animation: card-slide-in 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes card-slide-in {
  from { opacity: 0; transform: translateY(-12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.close-dialog-title {
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
  text-align: center;
  letter-spacing: 0.01em;
}

.close-dialog-subtitle {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 32px;
  text-align: center;
  line-height: 1.5;
}

.close-dialog-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
}

.close-dialog-btn {
  flex: 1;
  padding: 12px 20px;
  border-radius: 8px;
  border: none;
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  letter-spacing: 0.02em;
}

.close-dialog-btn.minimize {
  background: var(--accent-berry);
  color: #fff;
  box-shadow: 0 0 16px var(--accent-berry-glow);
}

.close-dialog-btn.minimize:hover {
  background: #e8185f;
  box-shadow: 0 0 24px rgba(212, 20, 90, 0.55);
  transform: translateY(-1px);
}

.close-dialog-btn.quit {
  background: rgba(61, 42, 92, 0.4);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.close-dialog-btn.quit:hover {
  background: rgba(180, 30, 60, 0.25);
  color: #ff6b8a;
  border-color: rgba(212, 20, 90, 0.4);
}

.close-dialog-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  cursor: pointer;
}

.close-dialog-checkbox-row input[type="checkbox"] {
  accent-color: var(--accent-berry);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.close-dialog-checkbox-label {
  font-family: var(--font-body);
  font-size: 0.8rem;
  color: var(--text-muted);
  user-select: none;
  cursor: pointer;
}
```

**Step 2: Create the TSX component**

Create `src/Brmble.Web/src/components/CloseDialog/CloseDialog.tsx` with this content:

```tsx
import { useState } from 'react';
import './CloseDialog.css';

interface CloseDialogProps {
  isOpen: boolean;
  onMinimize: (dontAskAgain: boolean) => void;
  onQuit: (dontAskAgain: boolean) => void;
}

export function CloseDialog({ isOpen, onMinimize, onQuit }: CloseDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="close-dialog-overlay">
      <div className="close-dialog-card">
        <h2 className="close-dialog-title">Leaving so soon?</h2>
        <p className="close-dialog-subtitle">Choose what happens when you close the window.</p>

        <div className="close-dialog-buttons">
          <button
            className="close-dialog-btn minimize"
            onClick={() => onMinimize(dontAskAgain)}
          >
            Minimize to tray
          </button>
          <button
            className="close-dialog-btn quit"
            onClick={() => onQuit(dontAskAgain)}
          >
            Quit
          </button>
        </div>

        <label className="close-dialog-checkbox-row">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={e => setDontAskAgain(e.target.checked)}
          />
          <span className="close-dialog-checkbox-label">Don't ask again</span>
        </label>
      </div>
    </div>
  );
}
```

**Step 3: Verify files exist and have no TypeScript errors**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/CloseDialog/
git commit -m "feat: add CloseDialog React component"
```

---

### Task 2: Wire CloseDialog into App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add state and import**

In `App.tsx`, add the import at the top (with other component imports):
```tsx
import { CloseDialog } from './components/CloseDialog/CloseDialog';
```

**Step 2: Add showCloseDialog state**

Inside `function App()`, after the other `useState` declarations, add:
```tsx
const [showCloseDialog, setShowCloseDialog] = useState(false);
```

**Step 3: Register bridge handler**

Inside the `useEffect` that registers bridge handlers (around line 76), add these two listeners and their cleanup:

```tsx
const onShowCloseDialog = () => {
  setShowCloseDialog(true);
};

bridge.on('window.showCloseDialog', onShowCloseDialog);
```

And in the cleanup `return () => { ... }` block, add:
```tsx
bridge.off('window.showCloseDialog', onShowCloseDialog);
```

**Step 4: Add handler functions**

After the `handleToggleDeaf` function (around line 262), add:

```tsx
const handleCloseMinimize = (dontAskAgain: boolean) => {
  setShowCloseDialog(false);
  if (dontAskAgain) {
    bridge.send('window.setClosePreference', { action: 'minimize' });
  }
  bridge.send('window.minimize');
};

const handleCloseQuit = (dontAskAgain: boolean) => {
  setShowCloseDialog(false);
  if (dontAskAgain) {
    bridge.send('window.setClosePreference', { action: 'quit' });
  }
  bridge.send('window.quit');
};
```

**Step 5: Render CloseDialog in JSX**

Just before the closing `</div>` of the root `<div className="app">` (after the `<SettingsModal>` block), add:

```tsx
<CloseDialog
  isOpen={showCloseDialog}
  onMinimize={handleCloseMinimize}
  onQuit={handleCloseQuit}
/>
```

**Step 6: Verify no TypeScript errors**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: no errors

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire CloseDialog into App"
```

---

### Task 3: Update C# — Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Replace `_skipCloseConfirmation` with `_closeAction`**

Change line 23:
```csharp
private static bool _skipCloseConfirmation;
```
to:
```csharp
private static string? _closeAction; // null = ask, "minimize", "quit"
```

**Step 2: Add `window.quit` bridge handler**

In `SetupBridgeHandlers()`, after the `window.close` handler (around line 108-113), add:

```csharp
_bridge.RegisterHandler("window.quit", _ =>
{
    Win32Window.DestroyWindow(_hwnd);
    return Task.CompletedTask;
});
```

**Step 3: Update `window.setClosePreference` handler**

Replace the existing handler (around line 114-119):
```csharp
_bridge.RegisterHandler("window.setClosePreference", data =>
{
    if (data.TryGetProperty("action", out var a))
        _closeAction = a.GetString();
    return Task.CompletedTask;
});
```

**Step 4: Update WM_CLOSE handler**

Replace the entire `case Win32Window.WM_CLOSE:` block (approximately lines 184-205) with:

```csharp
case Win32Window.WM_CLOSE:
    if (_closeAction == "quit")
    {
        Win32Window.DestroyWindow(hwnd);
    }
    else if (_closeAction == "minimize")
    {
        Win32Window.ShowWindow(hwnd, Win32Window.SW_HIDE);
    }
    else
    {
        // Ask via WebView2 modal — fire-and-forget
        _bridge?.Send("window.showCloseDialog");
    }
    return IntPtr.Zero;
```

**Step 5: Build to verify no errors**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded, 0 errors

**Step 6: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: replace blocking ShowCloseDialog with bridge fire-and-forget"
```

---

### Task 4: Clean up Win32Window.cs

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

**Step 1: Remove unused TaskDialog code**

Remove the following from `Win32Window.cs` (they are all now dead code):
- The `TaskDialogIndirect` P/Invoke declaration (lines ~133-135)
- The `TASKDIALOGCONFIG` struct (lines ~137-156)
- The `TASKDIALOG_BUTTON` struct (lines ~158-163)
- The `IDQUIT`, `IDMINIMIZE`, `TDF_USE_COMMAND_LINK` constants (lines ~165-167)
- The `ShowCloseDialog` method (lines ~169-228)
- The `ShowMessageBox` method (lines ~230-239)

**Step 2: Build to verify no errors**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded, 0 errors

**Step 3: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "refactor: remove dead Win32 TaskDialog/MessageBox close dialog code"
```

---

### Task 5: Build frontend and run full build verification

**Step 1: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build complete, no errors

**Step 2: Build all**

Run: `dotnet build`
Expected: Build succeeded

**Step 3: Commit if any auto-generated files changed**

```bash
git status
# if nothing changed: done
# if dist/ or other generated files changed: commit them
```

---

### Task 6: Manual smoke test checklist

After running the app (`dotnet run --project src/Brmble.Client`):

1. Click the X button in the top-right corner
2. Verify the Brmble-styled modal appears (dark purple background, "Leaving so soon?" title)
3. Click "Minimize to tray" → window hides, app still in system tray
4. Re-open from tray, click X again → dialog appears again
5. Check "Don't ask again", click "Minimize to tray" → window hides
6. Click X again → window hides immediately (no dialog)
7. Re-open from tray, click X → window hides immediately (preference persists in session)
8. Restart app, click X → dialog appears again (preference is session-only)
9. Click X, check "Don't ask again", click "Quit" → app closes
