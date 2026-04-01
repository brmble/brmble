# Channel Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement right-click context menu option to edit channel name/description, with changes syncing to Mumble and Matrix. Add Subchannel is deferred to a future enhancement.

**Architecture:** Frontend sends bridge messages → Client handles via Mumble protocol (ChannelState packets) → Mumble broadcasts to all clients → Server handles Matrix sync via existing event handlers.

**Tech Stack:** React (frontend), C#/MumbleSharp (client), Mumble protocol

---

## File Structure

### Frontend (src/Brmble.Web/src)
- Modify: `components/Sidebar/ChannelTree.tsx` — wire up dialogs, handle form submissions
- Modify: `types/index.ts` — add `description` field to Channel interface
- Create: `components/EditChannelDialog/EditChannelDialog.tsx` — edit channel modal
- Create: `components/EditChannelDialog/EditChannelDialog.css` — modal styling
- Create: `components/RenameConfirmDialog/RenameConfirmDialog.tsx` — name confirmation modal
- Create: `components/RenameConfirmDialog/RenameConfirmDialog.css` — modal styling
- Modify: `App.tsx` — add error toast state for channel operations

### Client (src/Brmble.Client)
- Modify: `Services/Voice/MumbleAdapter.cs` — add handler for `voice.editChannel`

---

## Task 1: Add description field to Channel type

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:8-13`

- [ ] **Step 1: Add description to Channel interface**

```typescript
export interface Channel {
  id: number;
  name: string;
  parent?: number;
  type?: 'voice' | 'text';
  description?: string;  // Add this field
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add description field to Channel type"
```

---

## Task 2: Create EditChannelDialog component

**Files:**
- Create: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx`
- Create: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.css`

- [ ] **Step 1: Create EditChannelDialog.tsx**

```tsx
import { useState, useEffect } from 'react';
import './EditChannelDialog.css';

interface EditChannelDialogProps {
  isOpen: boolean;
  channelId: number;
  initialName: string;
  initialDescription?: string;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}

export function EditChannelDialog({
  isOpen,
  channelId,
  initialName,
  initialDescription = '',
  onClose,
  onSave,
}: EditChannelDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, description);
  };

  const nameChanged = name !== initialName;
  const hasChanges = nameChanged || description !== initialDescription;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="edit-channel-dialog glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-header">
          <h2 className="heading-title modal-title">Edit Channel</h2>
        </div>

        <form onSubmit={handleSubmit} className="edit-channel-form">
          <div className="form-group">
            <label htmlFor="channel-name">Name</label>
            <input
              id="channel-name"
              className="brmble-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="channel-description">Description</label>
            <textarea
              id="channel-description"
              className="brmble-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-group password-placeholder">
            <label>Password</label>
            <div className="password-coming-soon">
              <span className="coming-soon-text">Coming soon</span>
              <p className="coming-soon-note">Channel passwords require ACL support (see issue #421)</p>
            </div>
          </div>

          <div className="edit-channel-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!hasChanges || !name.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create EditChannelDialog.css**

```css
.edit-channel-dialog {
  padding: var(--space-xl);
  width: 100%;
  max-width: 420px;
  position: relative;
}

.edit-channel-dialog .modal-close {
  position: absolute;
  top: var(--space-md);
  right: var(--space-md);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.edit-channel-dialog .modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.edit-channel-dialog .modal-header {
  margin-bottom: var(--space-lg);
}

.edit-channel-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.edit-channel-form .form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.edit-channel-form .form-group label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.edit-channel-form textarea {
  resize: vertical;
  min-height: 60px;
}

.password-placeholder {
  padding: var(--space-md);
  background: var(--bg-hover-light);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
}

.password-placeholder label {
  margin-bottom: var(--space-xs);
}

.coming-soon-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-style: italic;
}

.coming-soon-note {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin: var(--space-xs) 0 0;
}

.edit-channel-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/EditChannelDialog/
git commit -m "feat: create EditChannelDialog component"
```

---

## Task 3: Create RenameConfirmDialog component

**Files:**
- Create: `src/Brmble.Web/src/components/RenameConfirmDialog/RenameConfirmDialog.tsx`
- Create: `src/Brmble.Web/src/components/RenameConfirmDialog/RenameConfirmDialog.css`

- [ ] **Step 1: Create RenameConfirmDialog.tsx**

```tsx
import { useState } from 'react';
import './RenameConfirmDialog.css';

interface RenameConfirmDialogProps {
  isOpen: boolean;
  oldName: string;
  newName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RenameConfirmDialog({
  isOpen,
  oldName,
  newName,
  onClose,
  onConfirm,
}: RenameConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText.toLowerCase() === 'change') {
      onConfirm();
    }
  };

  const isValid = confirmText.toLowerCase() === 'change';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="rename-confirm-dialog glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="heading-title modal-title">Confirm Channel Rename</h2>
          <p className="modal-subtitle">
            Renaming "{oldName}" to "{newName}" will update the channel name for all users.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rename-confirm-form">
          <div className="form-group">
            <label htmlFor="confirm-rename">Type "change" to confirm</label>
            <input
              id="confirm-rename"
              className="brmble-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="change"
              autoFocus
            />
          </div>

          <div className="rename-confirm-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!isValid}>
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create RenameConfirmDialog.css**

```css
.rename-confirm-dialog {
  padding: var(--space-xl);
  width: 100%;
  max-width: 380px;
}

.rename-confirm-dialog .modal-header {
  margin-bottom: var(--space-lg);
}

.rename-confirm-dialog .modal-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  margin-top: var(--space-xs);
}

.rename-confirm-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.rename-confirm-form .form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.rename-confirm-form .form-group label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.rename-confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/RenameConfirmDialog/
git commit -m "feat: create RenameConfirmDialog component"
```

---

## Task 4: Wire up dialogs in ChannelTree and add error toast state

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` — add error toast state
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` — wire up dialogs

- [ ] **Step 1: Add channel error toast state in App.tsx**

Find the `screenShareToast` state (around line 1661) and add similar state for channel errors:

```tsx
// Add after screenShareToast state
const [channelError, setChannelError] = useState<string | null>(null);
```

Add the toast rendering (find where screenShareToast is rendered around line 2082):

```tsx
{channelError && (
  <Toast
    message={channelError}
    onDismiss={() => setChannelError(null)}
  />
)}
```

- [ ] **Step 2: Update ChannelTree props to include error handler**

Modify the `ChannelTreeProps` interface (around line 38):

```tsx
interface ChannelTreeProps {
  // ... existing props
  onChannelError?: (message: string) => void;  // Add this
}
```

Add to the destructured props (around line 55):

```tsx
export function ChannelTree({ ..., onChannelError }: ChannelTreeProps) {
```

- [ ] **Step 3: Replace inline dialogs in ChannelTree with proper components**

Replace the existing `editChannelDialog` state and dialog (around lines 62, 641-659):

```tsx
// State already exists: editChannelDialog
// Replace the inline dialog with:
{editChannelDialog && (
  <EditChannelDialog
    isOpen={true}
    channelId={editChannelDialog.id}
    initialName={editChannelDialog.name}
    initialDescription={channels.find(c => c.id === editChannelDialog.id)?.description}
    onClose={() => setEditChannelDialog(null)}
    onSave={(name, description) => {
      // Handle save
    }}
  />
)}
```

Remove the `addSubchannelDialog` inline dialog entirely (around lines 662-681).

- [ ] **Step 4: Add rename confirmation dialog state and logic**

Add state after the other dialog states (around line 64):

```tsx
const [renameConfirmDialog, setRenameConfirmDialog] = useState<{
  channelId: number;
  oldName: string;
  newName: string;
  description: string;
} | null>(null);
```

Add the rename confirmation dialog before the edit dialog (around line 640):

```tsx
{renameConfirmDialog && (
  <RenameConfirmDialog
    isOpen={true}
    oldName={renameConfirmDialog.oldName}
    newName={renameConfirmDialog.newName}
    onClose={() => setRenameConfirmDialog(null)}
    onConfirm={() => {
      bridge.send('voice.editChannel', {
        channelId: renameConfirmDialog.channelId,
        name: renameConfirmDialog.newName,
        description: renameConfirmDialog.description,
      });
      setEditChannelDialog(null);
      setRenameConfirmDialog(null);
    }}
  />
)}
```

- [ ] **Step 5: Update edit dialog handler to show confirmation**

Replace the `onSave` handler in the EditChannelDialog:

```tsx
onSave={(name, description) => {
  const channel = channels.find(c => c.id === editChannelDialog!.id);
  const oldName = channel?.name || '';
  
  if (name !== oldName) {
    // Name changed - show confirmation
    setRenameConfirmDialog({
      channelId: editChannelDialog!.id,
      oldName,
      newName: name,
      description,
    });
  } else {
    // Name unchanged - save directly
    bridge.send('voice.editChannel', {
      channelId: editChannelDialog!.id,
      name,
      description,
    });
    setEditChannelDialog(null);
  }
}}
```

- [ ] **Step 6: Update add subchannel handler**

```tsx
onCreate={(name) => {
```

- [ ] **Step 7: Update context menu handlers**

The existing Edit handler (lines 392-394) needs to be updated to pass description:

```tsx
// Edit handler (lines 392-394) - change to pass description
onClick: () => {
  const channel = channels.find(c => c.id === channelContextMenu.channelId);
  setEditChannelDialog({ 
    id: channelContextMenu.channelId, 
    name: channelContextMenu.channelName,
    description: channel?.description || '',
  });
  setChannelContextMenu(null);
},
```

Remove the Add Subchannel context menu handler entirely (lines 399-408).

- [ ] **Step 8: Add imports for new dialogs**

At the top of ChannelTree.tsx:

```tsx
import { EditChannelDialog } from '../EditChannelDialog/EditChannelDialog';
import { RenameConfirmDialog } from '../RenameConfirmDialog/RenameConfirmDialog';
```

- [ ] **Step 9: Update the `editChannelDialog` type to include description**

```tsx
const [editChannelDialog, setEditChannelDialog] = useState<{ 
  id: number; 
  name: string;
  description?: string;
} | null>(null);
```

- [ ] **Step 10: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: wire up channel edit dialogs"
```

---

## Task 5: Add client-side bridge handlers

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Add voice.editChannel handler**

Find where other voice handlers are registered (around line 1949, after `voice.setComment` handler) and add:

```csharp
bridge.RegisterHandler("voice.editChannel", data =>
{
    if (Connection is not { State: ConnectionStates.Connected })
        return Task.CompletedTask;

    var channelId = data.TryGetProperty("channelId", out var cid) ? cid.GetUInt32() : 0u;
    if (channelId == 0) return Task.CompletedTask;

    var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
    var description = data.TryGetProperty("description", out var d) ? d.GetString() : null;

    // Find the channel in our local state
    var channel = Channels.FirstOrDefault(c => c.Id == channelId);
    if (channel == null) return Task.CompletedTask;

    // Update local state
    if (name != null)
        channel.Name = name;
    if (description != null)
        channel.Description = description;

    // Send ChannelState to Mumble server
    Connection.SendControl(PacketType.ChannelState, new ChannelState
    {
        ChannelId = channelId,
        Name = name,
        Description = description,
    });

    return Task.CompletedTask;
});
```

- [ ] **Step 2: Add voice.createChannel handler**

Add after the editChannel handler:

```csharp
bridge.RegisterHandler("voice.createChannel", data =>
{
    if (Connection is not { State: ConnectionStates.Connected })
        return Task.CompletedTask;

    var parentId = data.TryGetProperty("parentId", out var pid) ? pid.GetUInt32() : 0u;
    var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;

    if (parentId == 0 || string.IsNullOrEmpty(name))
        return Task.CompletedTask;

    // Mumble doesn't have a direct "create channel" packet from client
    // The server handles this via ICE API (see Task 7)
    // For now, we'll need to implement server-side handling
    
    return Task.CompletedTask;
});
```

Note: Creating channels from the client requires a different approach. The Mumble protocol doesn't have a direct "create channel" packet. We need to handle this via the server-side ICE API.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add voice.editChannel handler to MumbleAdapter"
```

---

## Task 6: Add error handling for channel operations

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

- [ ] **Step 1: Handle voice.error events for channel operations**

In App.tsx, add a handler for `voice.error` that checks for channel-related errors and shows the toast:

```tsx
const onVoiceError = useCallback((data: unknown) => {
  const d = data as { message?: string; type?: string } | undefined;
  if (d?.message) {
    // Check if it's a channel operation error
    if (d.type?.includes('channel') || d.message.includes('channel')) {
      setChannelError(d.message);
    }
    // Other errors are handled elsewhere
  }
}, []);
```

Make sure to register this handler in the useEffect (around line 1200).

- [ ] **Step 2: Pass error handler to ChannelTree**

Update the ChannelTree component call in App.tsx:

```tsx
<ChannelTree
  // ... other props
  onChannelError={setChannelError}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: add error handling for channel operations"
```

---

## Task 9: Testing

- [ ] **Step 1: Build the frontend**

```bash
cd src/Brmble.Web && npm run build
```

- [ ] **Step 2: Build the client**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

- [ ] **Step 3: Build the server**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

- [ ] **Step 4: Test manual scenarios**

1. Right-click a channel → Edit → change name → confirm → verify Mumble client sees new name
2. Right-click a channel → Edit → change description → save → verify Matrix room description updates
3. Test error scenarios: edit without permission
4. Verify Matrix room name updates when channel is renamed

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add description to Channel type |
| 2 | Create EditChannelDialog component |
| 3 | Create RenameConfirmDialog component |
| 4 | Wire up dialogs in ChannelTree |
| 5 | Add client bridge handlers |
| 6 | Add error handling |
| 7 | Testing |

## Out of Scope (Future Enhancement)

- Add Subchannel: Requires server-side ICE API implementation (Mumble protocol doesn't support client-initiated channel creation)
