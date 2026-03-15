# Avatar UI Enhancements Implementation Plan

> This plan was executed on the `feature/avatar-ui-enhancements` branch. All tasks are complete.

**Goal:** Implement three avatar-related UI improvements: reposition Upload/Remove buttons (#273), create a dedicated avatar editor modal (#278), and add rich user tooltips with enlarged avatars and comments (#279).

**Architecture:** Three independent UI changes that share the Avatar component. #273 is CSS-only with minor JSX restructure. #278 creates a new modal component wired through App.tsx. #279 creates a new tooltip component replacing simple text tooltips on user rows.

**Tech Stack:** React, TypeScript, CSS (token-based per UI_GUIDE.md)

---

### Task 1: Reposition Upload/Remove buttons in ProfileSettingsTab (#273)

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx:76-95`

**Step 1: Update CSS to make avatar section a flex row with buttons pushed right**

In `ProfileSettingsTab.css`, update `.profile-avatar-section` to be a row with `justify-content: space-between`, and change `.profile-avatar-actions` to stack vertically on the right:

```css
.profile-avatar-section {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md);
}

.profile-avatar-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}

.profile-display-name {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--text-primary);
}

.profile-avatar-status {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.profile-avatar-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.profile-avatar-actions .btn {
  min-width: 100px;
}
```

**Step 2: Restructure JSX to move buttons outside of profile-avatar-info**

In `ProfileSettingsTab.tsx`, move the `profile-avatar-actions` div and the `profile-avatar-hint` span out of `profile-avatar-info` and into a sibling position within `profile-avatar-section`:

Replace lines 78-94:
```tsx
<div className="profile-avatar-section">
  <Avatar user={currentUser} size={80} />
  <div className="profile-avatar-info">
    <span className="profile-display-name">{currentUser.name}</span>
    <span className="profile-avatar-status">{statusText}</span>
  </div>
  {connected ? (
    <div className="profile-avatar-actions">
      <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload</button>
      {currentUser.avatarUrl && (
        <button className="btn btn-secondary" onClick={onRemoveAvatar}>Remove</button>
      )}
    </div>
  ) : (
    <span className="profile-avatar-hint" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Connect to a server to change your avatar</span>
  )}
</div>
```

**Step 3: Build and verify visually**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build, no errors.

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.css
git commit -m "fix: reposition avatar Upload/Remove buttons to right side (#273)"
```

---

### Task 2: Create AvatarEditorModal component (#278)

**Files:**
- Create: `src/Brmble.Web/src/components/AvatarEditorModal/AvatarEditorModal.tsx`
- Create: `src/Brmble.Web/src/components/AvatarEditorModal/AvatarEditorModal.css`

**Step 1: Create the CSS file**

Create `src/Brmble.Web/src/components/AvatarEditorModal/AvatarEditorModal.css`:

```css
/* AvatarEditorModal — standalone avatar editing modal */

.avatar-editor-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  backdrop-filter: var(--glass-blur-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: fadeIn var(--animation-fast) ease backwards;
}

.avatar-editor {
  width: 100%;
  max-width: 380px;
  padding: var(--space-xl) var(--space-lg) var(--space-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar-editor .modal-header {
  text-align: center;
  margin-bottom: var(--space-lg);
  width: 100%;
}

.avatar-editor .modal-title {
  margin: 0;
  opacity: 0;
  animation: content-fade-in var(--animation-normal) ease forwards;
  animation-delay: calc(1 * var(--stagger-step));
}

.avatar-editor-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  opacity: 0;
  animation: content-fade-in var(--animation-normal) ease forwards;
  animation-delay: calc(2 * var(--stagger-step));
}

.avatar-editor-name {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--text-primary);
  font-weight: 600;
}

.avatar-editor-status {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.avatar-editor-actions {
  display: flex;
  gap: var(--space-sm);
  width: 100%;
  opacity: 0;
  animation: content-fade-in var(--animation-normal) ease forwards;
  animation-delay: calc(3 * var(--stagger-step));
}

.avatar-editor-actions .btn {
  flex: 1;
}

.avatar-editor-footer {
  display: flex;
  justify-content: center;
  margin-top: var(--space-lg);
  width: 100%;
  opacity: 0;
  animation: content-fade-in var(--animation-normal) ease forwards;
  animation-delay: calc(4 * var(--stagger-step));
}
```

**Step 2: Create the component**

Create `src/Brmble.Web/src/components/AvatarEditorModal/AvatarEditorModal.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import './AvatarEditorModal.css';

interface AvatarEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
}

function getAvatarStatusText(user: AvatarEditorModalProps['currentUser']): string {
  if (!user.avatarUrl) return 'Default';
  if (user.avatarUrl.startsWith('mxc://') || user.avatarUrl.includes('/_matrix/')) {
    return 'Uploaded';
  }
  return 'From Mumble';
}

export function AvatarEditorModal({ isOpen, onClose, currentUser, onUploadAvatar, onRemoveAvatar }: AvatarEditorModalProps) {
  const [showUpload, setShowUpload] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const statusText = getAvatarStatusText(currentUser);

  // Reset upload view when modal opens/closes
  useEffect(() => {
    if (!isOpen) setShowUpload(false);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showUpload) {
          setShowUpload(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, showUpload]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const card = dialogRef.current;
    if (!card) return;

    const focusable = card.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = card.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      if (current.length === 0) return;
      const f = current[0];
      const l = current[current.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTrap);
    return () => window.removeEventListener('keydown', handleTrap);
  }, [isOpen, showUpload]);

  if (!isOpen) return null;

  // When upload cropper is active, render AvatarUpload instead
  if (showUpload) {
    return (
      <AvatarUpload
        onUpload={(blob, contentType) => {
          onUploadAvatar(blob, contentType);
          setShowUpload(false);
          onClose();
        }}
        onCancel={() => setShowUpload(false)}
      />
    );
  }

  return (
    <div className="avatar-editor-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="avatar-editor glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="avatar-editor-title" className="heading-title modal-title">Edit Avatar</h2>
        </div>

        <div className="avatar-editor-preview">
          <Avatar user={currentUser} size={120} />
          <span className="avatar-editor-name">{currentUser.name}</span>
          <span className="avatar-editor-status">{statusText}</span>
        </div>

        <div className="avatar-editor-actions">
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            Upload
          </button>
          {currentUser.avatarUrl && (
            <button className="btn btn-secondary" onClick={() => { onRemoveAvatar(); }}>
              Remove
            </button>
          )}
        </div>

        <div className="avatar-editor-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build.

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/AvatarEditorModal/
git commit -m "feat: create AvatarEditorModal component (#278)"
```

---

### Task 3: Wire AvatarEditorModal into App.tsx and Header (#278)

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add state and import**

At the top of App.tsx, add the import:
```tsx
import { AvatarEditorModal } from './components/AvatarEditorModal/AvatarEditorModal';
```

Near line 177 (where `showSettings` state is), add:
```tsx
const [showAvatarEditor, setShowAvatarEditor] = useState(false);
```

**Step 2: Change onAvatarClick to open avatar editor instead of settings**

At line 1496, change:
```tsx
onAvatarClick={() => setShowSettings(true)}
```
to:
```tsx
onAvatarClick={connected ? () => setShowAvatarEditor(true) : undefined}
```

This also handles the "disable when disconnected" requirement — when `connected` is false, `onAvatarClick` is `undefined`, which disables the button in UserPanel (it already has `disabled={!onAvatarClick}`).

**Step 3: Render AvatarEditorModal**

After the `<SettingsModal>` block (around line 1636), add:
```tsx
<AvatarEditorModal
  isOpen={showAvatarEditor}
  onClose={() => setShowAvatarEditor(false)}
  currentUser={{
    name: username ?? 'Unknown',
    matrixUserId: matrixCredentials?.userId,
    avatarUrl: currentUserAvatarUrl,
  }}
  onUploadAvatar={onUploadAvatar}
  onRemoveAvatar={onRemoveAvatar}
/>
```

**Step 4: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build.

**Step 5: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire AvatarEditorModal to header avatar click (#278)"
```

---

### Task 4: Add "Edit Avatar" to self context menus (#278)

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add onEditAvatar prop to Sidebar**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`:

Add to `SidebarProps` interface (around line 33):
```tsx
onEditAvatar?: () => void;
```

Add to destructured props (around line 57):
```tsx
onEditAvatar
```

Add an "Edit Avatar" context menu item for self users. In the context menu items array (around line 265, after the "User Information" item), add:
```tsx
...(contextMenu.isSelf && onEditAvatar ? [{
  label: 'Edit Avatar',
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  onClick: () => onEditAvatar(),
}] : []),
```

**Step 2: Add onEditAvatar prop to ChannelTree**

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`:

Add to `ChannelTreeProps` interface (around line 46):
```tsx
onEditAvatar?: () => void;
```

Add to destructured props (around line 49):
```tsx
onEditAvatar
```

Add the same "Edit Avatar" context menu item for self users in the ChannelTree context menu items array, after "User Information":
```tsx
...(contextMenu.isSelf && onEditAvatar ? [{
  label: 'Edit Avatar',
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  onClick: () => onEditAvatar(),
}] : []),
```

**Step 3: Pass onEditAvatar from Sidebar to ChannelTree**

In `Sidebar.tsx`, where `<ChannelTree>` is rendered, add the prop:
```tsx
onEditAvatar={onEditAvatar}
```

**Step 4: Pass onEditAvatar from App.tsx to Sidebar**

In `App.tsx`, in the `<Sidebar>` JSX (around line 1518-1540), add:
```tsx
onEditAvatar={connected ? () => setShowAvatarEditor(true) : undefined}
```

**Step 5: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build.

**Step 6: Commit**

```
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: add Edit Avatar to self right-click context menu (#278)"
```

---

### Task 5: Create UserTooltip component (#279)

**Files:**
- Create: `src/Brmble.Web/src/components/UserTooltip/UserTooltip.tsx`
- Create: `src/Brmble.Web/src/components/UserTooltip/UserTooltip.css`

**Step 1: Create the CSS file**

Create `src/Brmble.Web/src/components/UserTooltip/UserTooltip.css`:

```css
/* UserTooltip — rich hover tooltip with avatar and comment */

.user-tooltip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  padding: var(--space-sm);
  min-width: 200px;
  max-width: 280px;
}

.user-tooltip-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  min-width: 0;
}

.user-tooltip-name {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-tooltip-comment {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

**Step 2: Create the component**

Create `src/Brmble.Web/src/components/UserTooltip/UserTooltip.tsx`:

The existing `<Tooltip>` component only accepts a `content: string` prop — it renders the content as plain text inside a portal. For a rich tooltip with JSX (avatar, styled text), we need a new component that wraps the same positioning logic but renders custom JSX.

Looking at `Tooltip.tsx`, it uses `createPortal` with fixed positioning, `transformMap` for alignment, and show/hide with delay. We'll create `UserTooltip` as a wrapper that uses the same portal approach but renders rich content.

```tsx
import { useState, useRef, useCallback, useEffect, useId, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '../Avatar/Avatar';
import './UserTooltip.css';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

interface UserTooltipUser {
  name: string;
  matrixUserId?: string;
  avatarUrl?: string;
  comment?: string;
  self?: boolean;
}

interface UserTooltipProps {
  user: UserTooltipUser;
  children: React.ReactElement<AnyProps>;
  position?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  delay?: number;
}

const transformMap: Record<string, Record<string, string>> = {
  top:    { start: 'translateY(-100%)',        center: 'translateX(-50%) translateY(-100%)', end: 'translateX(-100%) translateY(-100%)' },
  bottom: { start: '',                         center: 'translateX(-50%)',                   end: 'translateX(-100%)' },
};

export function UserTooltip({ user, children, position = 'top', align = 'center', delay = 400 }: UserTooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [effectivePosition, setEffectivePosition] = useState(position);
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, hide]);

  useEffect(() => {
    setEffectivePosition(position);
  }, [position, visible]);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const bottomGap = 14;

    const anchorLeft =
      align === 'start'  ? rect.left :
      align === 'end'    ? rect.right :
      rect.left + rect.width / 2;

    let top = position === 'top' ? rect.top - gap : rect.bottom + bottomGap;
    let left = anchorLeft;

    setCoords({ top, left });

    const rafId = requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const tt = tooltipRef.current.getBoundingClientRect();
      let adjustedTop = top;
      let adjustedLeft = left;
      let flippedPosition: 'top' | 'bottom' | null = null;

      if (align === 'center') {
        adjustedLeft = Math.max(8 + tt.width / 2, Math.min(adjustedLeft, window.innerWidth - tt.width / 2 - 8));
      } else if (align === 'start' && tt.right > window.innerWidth - 8) {
        adjustedLeft = window.innerWidth - tt.width - 8;
      } else if (align === 'end' && tt.left < 8) {
        adjustedLeft = tt.width + 8;
      }

      if (position === 'top' && tt.top < 0) {
        adjustedTop = rect.bottom + bottomGap;
        flippedPosition = 'bottom';
      } else if (position === 'bottom' && tt.bottom > window.innerHeight) {
        adjustedTop = rect.top - gap;
        flippedPosition = 'top';
      }

      if (adjustedTop !== top || adjustedLeft !== left) {
        setCoords({ top: adjustedTop, left: adjustedLeft });
      }
      if (flippedPosition) {
        setEffectivePosition(flippedPosition);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [visible, position, align]);

  return (
    <>
      {cloneElement(children, {
        ref: triggerRef,
        'aria-describedby': visible ? tooltipId : undefined,
        onMouseEnter: (e: React.MouseEvent) => {
          show();
          children.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          hide();
          children.props.onMouseLeave?.(e);
        },
        onFocus: (e: React.FocusEvent) => {
          show();
          children.props.onFocus?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
          hide();
          children.props.onBlur?.(e);
        },
      })}
      {visible && createPortal(
        <div
          className="brmble-tooltip-portal"
          style={{
            top: coords.top,
            left: coords.left,
            transform: transformMap[effectivePosition][align],
          }}
        >
          <div className="brmble-tooltip" ref={tooltipRef} id={tooltipId} role="tooltip">
            <div className="user-tooltip">
              <Avatar
                user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }}
                size={64}
                isMumbleOnly={!user.self && !user.matrixUserId}
              />
              <div className="user-tooltip-info">
                <span className="user-tooltip-name">{user.name}</span>
                {user.comment && (
                  <span className="user-tooltip-comment">{user.comment}</span>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
```

**Step 3: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build.

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/UserTooltip/
git commit -m "feat: create UserTooltip component with enlarged avatar and comment (#279)"
```

---

### Task 6: Replace simple tooltips with UserTooltip on user rows (#279)

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

**Step 1: Update ChannelTree.tsx**

Add import at top:
```tsx
import { UserTooltip } from '../UserTooltip/UserTooltip';
```

Find each user row that uses `<Tooltip content={user.name}>` and replace with `<UserTooltip user={user}>`. The user rows in ChannelTree render users inside channel sections. Search for `<Tooltip content={user.name}` (or similar pattern wrapping user rows) and replace.

In the user row rendering (look for where users are mapped within channels), replace:
```tsx
<Tooltip content={user.name} position="right" align="center">
```
with:
```tsx
<UserTooltip user={user} position="right" align="center">
```

Note: The `UserTooltip` component accepts the same `children` pattern as `Tooltip`, so this is a drop-in replacement.

**Step 2: Update Sidebar.tsx**

Add import at top:
```tsx
import { UserTooltip } from '../UserTooltip/UserTooltip';
```

Find root user rows that use `<Tooltip content={user.name}>` and replace with `<UserTooltip user={user}>`.

**Step 3: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build.

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "feat: replace simple user tooltips with rich UserTooltip (#279)"
```

---

### Task 7: Final build verification and test

**Step 1: Full build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build, no TypeScript errors.

**Step 2: Run any existing tests**

Run: `cd src/Brmble.Web && npx vitest run`
Expected: All tests pass.

**Step 3: Run .NET build to ensure CopyWebDist works**

Run: `dotnet build`
Expected: Clean build.
