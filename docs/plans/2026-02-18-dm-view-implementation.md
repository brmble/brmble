# DM View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the modal-based DM panel with an integrated sliding view where the main content area transitions between channel chat and DM conversations, with a contact list on the right.

**Architecture:** The main content area becomes a sliding viewport with two panels (channel chat, DM view) side-by-side. CSS `translateX(-100%)` slides between them. A separate DM contact list panel slides in from the right edge. Both panels stay mounted in the DOM for state preservation. Right-click context menus on ChannelTree users initiate new DMs.

**Tech Stack:** React, TypeScript, CSS transitions (no animation libraries)

---

### Task 1: Add `appMode` state and refactor DM button to toggle

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:50-51`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx:5,13,60-68`

**Step 1: Replace `showDMPanel` with `appMode` state in App.tsx**

In `src/Brmble.Web/src/App.tsx`, replace line 51:

```tsx
const [showDMPanel, setShowDMPanel] = useState(false);
```

with:

```tsx
const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
const [selectedDMUserId, setSelectedDMUserId] = useState<string | null>(null);
const [selectedDMUserName, setSelectedDMUserName] = useState<string>('');
```

**Step 2: Update the DM toggle handler in App.tsx**

Replace lines 307-310 (`handleStartDM`):

```tsx
const handleStartDM = (userId: string) => {
  console.log('Starting DM with user:', userId);
  setShowDMPanel(false);
};
```

with:

```tsx
const toggleDMMode = () => {
  setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
};

const handleSelectDMUser = (userId: string, userName: string) => {
  setSelectedDMUserId(userId);
  setSelectedDMUserName(userName);
  setAppMode('dm');
};
```

**Step 3: Update `onOpenDMPanel` prop to `onToggleDM` in App.tsx**

Change line 320 from:

```tsx
onOpenDMPanel={() => setShowDMPanel(true)}
```

to:

```tsx
onToggleDM={toggleDMMode}
dmActive={appMode === 'dm'}
```

**Step 4: Update UserPanel props and DM button**

In `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`, update the interface:

```tsx
interface UserPanelProps {
  username?: string;
  onToggleDM: () => void;
  dmActive?: boolean;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
}
```

Update the component signature and DM button (lines 60-68) to use `onToggleDM` and show active state:

```tsx
<button 
  className={`user-panel-btn dm-btn ${dmActive ? 'active' : ''}`}
  onClick={onToggleDM}
  title="Direct Messages"
>
```

**Step 5: Update Header component to pass through new props**

The Header component passes `onOpenDMPanel` to UserPanel. Update it to pass `onToggleDM` and `dmActive` instead. Check `src/Brmble.Web/src/components/Header/Header.tsx` for the prop forwarding and update accordingly.

**Step 6: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: No TypeScript errors. The DM button should toggle without opening a modal.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: replace showDMPanel modal state with appMode toggle"
```

---

### Task 2: Create the sliding content container in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:344-352`
- Modify: `src/Brmble.Web/src/App.css:41-47`

**Step 1: Add DM chat store hook**

In `src/Brmble.Web/src/App.tsx`, add a second `useChatStore` call after line 57:

```tsx
const dmKey = selectedDMUserId ? `dm-${selectedDMUserId}` : 'no-dm';
const { messages: dmMessages, addMessage: addDMMessage } = useChatStore(dmKey);
```

**Step 2: Wrap main content in a sliding container**

Replace lines 344-352 in the JSX:

```tsx
<main className="main-content">
  <ChatPanel
    channelId={currentChannelId || undefined}
    channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
    messages={messages}
    currentUsername={username}
    onSendMessage={handleSendMessage}
  />
</main>
```

with:

```tsx
<main className="main-content">
  <div className={`content-slider ${appMode === 'dm' ? 'dm-active' : ''}`}>
    <div className="content-slide">
      <ChatPanel
        channelId={currentChannelId || undefined}
        channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
        messages={messages}
        currentUsername={username}
        onSendMessage={handleSendMessage}
      />
    </div>
    <div className="content-slide">
      <ChatPanel
        channelId={selectedDMUserId ? `dm-${selectedDMUserId}` : undefined}
        channelName={selectedDMUserName}
        messages={dmMessages}
        currentUsername={username}
        onSendMessage={handleSendDMMessage}
        isDM={true}
      />
    </div>
  </div>
</main>
```

**Step 3: Add `handleSendDMMessage` handler**

Add after `handleSendMessage`:

```tsx
const handleSendDMMessage = (content: string) => {
  if (username && content && selectedDMUserId) {
    addDMMessage(username, content);
    // TODO: Bridge call for DM delivery will be added when backend supports it
  }
};
```

**Step 4: Add sliding container CSS**

In `src/Brmble.Web/src/App.css`, add after the `.main-content` block (after line 47):

```css
.content-slider {
  display: flex;
  width: 200%;
  height: 100%;
  transition: transform var(--transition-slow);
  will-change: transform;
}

.content-slider.dm-active {
  transform: translateX(-50%);
}

.content-slide {
  width: 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
```

**Step 5: Update `.main-content` to clip overflow**

Ensure `.main-content` in App.css has `overflow: hidden` (it already does via `.app-body`, but make it explicit):

```css
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
```

**Step 6: Update ChatPanel to accept `isDM` prop**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`, add `isDM?: boolean` to the props interface. Update the header to show `@` instead of `#` when `isDM` is true:

In the props interface (line 7-13):

```tsx
interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string) => void;
  isDM?: boolean;
}
```

Update the component signature (line 15):

```tsx
export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, isDM }: ChatPanelProps) {
```

Update the empty state (lines 22-36) to show DM-appropriate text when `isDM` is true:

```tsx
if (!channelId) {
  return (
    <div className="chat-panel chat-panel--empty">
      <div className="chat-empty-state">
        <div className="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {isDM ? (
              <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></>
            ) : (
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            )}
          </svg>
        </div>
        <h3>{isDM ? 'Direct Messages' : 'Welcome to Brmble'}</h3>
        <p>{isDM ? 'Right-click a user in the channel tree to start a conversation' : 'Select a channel to start chatting'}</p>
      </div>
    </div>
  );
}
```

Update the header section (lines 42-58) to show `@` prefix and avatar for DMs:

```tsx
<div className="chat-header">
  <div className="chat-header-left">
    {isDM ? (
      <>
        <div className="dm-chat-avatar">
          <span>{channelName?.charAt(0).toUpperCase()}</span>
        </div>
        <h2 className="channel-title">{channelName}</h2>
      </>
    ) : (
      <>
        <span className="channel-hash">#</span>
        <h2 className="channel-title">{channelName}</h2>
      </>
    )}
  </div>
  {!isDM && (
    <div className="chat-header-right">
      <span className="user-count-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{userCount}</span>
      </span>
    </div>
  )}
</div>
```

Update the message input placeholder (line 81):

```tsx
<MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />
```

**Step 7: Add DM avatar CSS to ChatPanel.css**

Add to `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`:

```css
.dm-chat-avatar {
  width: 28px;
  height: 28px;
  min-width: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-berry) 0%, var(--accent-lemon) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dm-chat-avatar span {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--bg-deep);
}
```

**Step 8: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. Clicking the DM button should slide the main content left, showing the DM empty state.

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: add sliding content container for channel/DM view switching"
```

---

### Task 3: Create the DM contact list panel

**Files:**
- Create: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`
- Create: `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- Modify: `src/Brmble.Web/src/App.tsx` (add contact list to layout)
- Modify: `src/Brmble.Web/src/App.css` (add contact list panel styles)

**Step 1: Create the DMContactList component**

Create `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`:

```tsx
import { useState } from 'react';
import './DMContactList.css';

interface DMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: number;
}

interface DMContactListProps {
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (userId: string, userName: string) => void;
  visible: boolean;
}

export type { DMContact };

export function DMContactList({ contacts, selectedUserId, onSelectContact, visible }: DMContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = contacts.filter(c =>
    c.userName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (date?: Date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div className={`dm-contact-list ${visible ? 'visible' : ''}`}>
      <div className="dm-contact-list-header">
        <h3 className="dm-contact-list-title">Messages</h3>
      </div>

      <div className="dm-contact-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="dm-contact-search-input"
        />
      </div>

      <div className="dm-contact-entries">
        {filtered.length === 0 && (
          <p className="dm-contact-empty">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
        {filtered.map(contact => (
          <button
            key={contact.userId}
            className={`dm-contact-entry ${selectedUserId === contact.userId ? 'active' : ''}`}
            onClick={() => onSelectContact(contact.userId, contact.userName)}
          >
            <div className="dm-contact-avatar">
              <span>{contact.userName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="dm-contact-info">
              <div className="dm-contact-name-row">
                <span className="dm-contact-name">{contact.userName}</span>
                {contact.lastMessageTime && (
                  <span className="dm-contact-time">{formatTime(contact.lastMessageTime)}</span>
                )}
              </div>
              {contact.lastMessage && (
                <span className="dm-contact-preview">{contact.lastMessage}</span>
              )}
            </div>
            {contact.unread > 0 && (
              <span className="dm-contact-unread">{contact.unread}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Create the DMContactList CSS**

Create `src/Brmble.Web/src/components/DMContactList/DMContactList.css`:

```css
.dm-contact-list {
  width: 0;
  min-width: 0;
  height: calc(100vh - var(--header-height));
  background: var(--bg-primary);
  border-left: var(--glass-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width var(--transition-slow), min-width var(--transition-slow);
}

.dm-contact-list.visible {
  width: 260px;
  min-width: 260px;
}

.dm-contact-list-header {
  padding: 1rem 1rem 0.5rem;
}

.dm-contact-list-title {
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dm-contact-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.75rem 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-deep);
  border-radius: 8px;
  border: 1px solid transparent;
  transition: border-color var(--transition-fast);
  color: var(--text-muted);
}

.dm-contact-search:focus-within {
  border-color: var(--border-subtle);
}

.dm-contact-search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.8125rem;
}

.dm-contact-search-input::placeholder {
  color: var(--text-muted);
}

.dm-contact-entries {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.5rem;
}

.dm-contact-empty {
  color: var(--text-muted);
  font-size: 0.8125rem;
  text-align: center;
  padding: 1.5rem 0.75rem;
  font-style: italic;
}

.dm-contact-entry {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background var(--transition-fast);
  border: none;
  background: none;
}

.dm-contact-entry:hover {
  background: var(--bg-hover);
}

.dm-contact-entry.active {
  background: rgba(212, 20, 90, 0.12);
}

.dm-contact-avatar {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-berry) 0%, var(--accent-lemon) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dm-contact-avatar span {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--bg-deep);
}

.dm-contact-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.dm-contact-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.dm-contact-name {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dm-contact-time {
  font-size: 0.6875rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.dm-contact-preview {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dm-contact-unread {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: var(--accent-berry);
  border-radius: 9px;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

**Step 3: Add DMContactList to the app layout**

In `src/Brmble.Web/src/App.tsx`, import the component:

```tsx
import { DMContactList } from './components/DMContactList/DMContactList';
import type { DMContact } from './components/DMContactList/DMContactList';
```

Add state for DM contacts (after the `selectedDMUserName` state):

```tsx
const [dmContacts, setDmContacts] = useState<DMContact[]>([]);
```

In the JSX, add the contact list as a sibling to `main-content` inside `.app-body`, after `</main>`:

```tsx
<DMContactList
  contacts={dmContacts}
  selectedUserId={selectedDMUserId}
  onSelectContact={handleSelectDMUser}
  visible={appMode === 'dm'}
/>
```

**Step 4: Remove old DMPanel rendering**

Remove the old `<DMPanel>` JSX block (lines 367-373) and its import (line 9).

**Step 5: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. Toggling DM mode should slide content left and show the contact list panel on the right.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add DMContactList panel with search and contact entries"
```

---

### Task 4: Add right-click context menu on ChannelTree users

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:24-30,174-191`
- Create: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`
- Create: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`

**Step 1: Create a generic ContextMenu component**

Create `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import './ContextMenu.css';

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export type { ContextMenuItem };

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      if (x > maxX) menuRef.current.style.left = `${maxX}px`;
      if (y > maxY) menuRef.current.style.top = `${maxY}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className="context-menu-item"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Create ContextMenu CSS**

Create `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`:

```css
.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  background: var(--bg-primary);
  border: var(--glass-border);
  border-radius: 8px;
  padding: 0.375rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: contextMenuIn 150ms ease;
}

@keyframes contextMenuIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.context-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.context-menu-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
}

.context-menu-item:hover .context-menu-icon {
  color: var(--text-secondary);
}
```

**Step 3: Add context menu to ChannelTree user rows**

In `src/Brmble.Web/src/components/ChannelTree.tsx`:

Add `onStartDM?: (userId: string, userName: string) => void` to the `ChannelTreeProps` interface (line 24-30):

```tsx
interface ChannelTreeProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel?: (channelId: number) => void;
  onStartDM?: (userId: string, userName: string) => void;
}
```

Add state for the context menu:

```tsx
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string } | null>(null);
```

Import and add context menu handling. On each user row (lines 174-191), add an `onContextMenu` handler:

```tsx
<div 
  key={user.session} 
  className={`user-row ${user.self ? 'self' : ''}`}
  title={getUserTooltip(user)}
  onContextMenu={(e) => {
    if (!user.self && onStartDM) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name });
    }
  }}
>
```

Render the ContextMenu at the end of the component's return JSX (inside the `<div className="channel-tree">`):

```tsx
{contextMenu && (
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={[
      {
        label: 'Send Direct Message',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
        onClick: () => {
          if (onStartDM) onStartDM(contextMenu.userId, contextMenu.userName);
        },
      },
    ]}
    onClose={() => setContextMenu(null)}
  />
)}
```

Import at the top:

```tsx
import { ContextMenu } from './ContextMenu/ContextMenu';
```

**Step 4: Pass `onStartDM` from App.tsx to ChannelTree via Sidebar**

In `src/Brmble.Web/src/App.tsx`, add `onStartDM={handleSelectDMUser}` to the Sidebar props.

In `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`, add `onStartDM?: (userId: string, userName: string) => void` to the Sidebar props and pass it through to `<ChannelTree>`.

**Step 5: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. Right-clicking a user in the channel tree shows a context menu with "Send Direct Message".

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add right-click context menu on channel tree users for starting DMs"
```

---

### Task 5: Wire up DM contact persistence and conversation tracking

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Create a DM contacts persistence hook**

Add to `src/Brmble.Web/src/hooks/useChatStore.ts` (at the end of the file):

```tsx
const DM_CONTACTS_KEY = 'brmble_dm_contacts';

export interface StoredDMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unread: number;
}

export function loadDMContacts(): StoredDMContact[] {
  const stored = localStorage.getItem(DM_CONTACTS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveDMContacts(contacts: StoredDMContact[]) {
  localStorage.setItem(DM_CONTACTS_KEY, JSON.stringify(contacts));
}

export function upsertDMContact(userId: string, userName: string, lastMessage?: string) {
  const contacts = loadDMContacts();
  const existing = contacts.find(c => c.userId === userId);
  if (existing) {
    existing.userName = userName;
    if (lastMessage) {
      existing.lastMessage = lastMessage;
      existing.lastMessageTime = new Date().toISOString();
    }
  } else {
    contacts.unshift({
      userId,
      userName,
      lastMessage,
      lastMessageTime: lastMessage ? new Date().toISOString() : undefined,
      unread: 0,
    });
  }
  // Sort by most recent message
  contacts.sort((a, b) => {
    if (!a.lastMessageTime) return 1;
    if (!b.lastMessageTime) return -1;
    return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
  });
  saveDMContacts(contacts);
  return contacts;
}
```

**Step 2: Wire up contact tracking in App.tsx**

Import the new functions:

```tsx
import { useChatStore, addMessageToStore, loadDMContacts, upsertDMContact } from './hooks/useChatStore';
import type { StoredDMContact } from './hooks/useChatStore';
```

Remove the `DMContact` import from DMContactList (use `StoredDMContact` mapped to the component's expected shape instead).

Initialize `dmContacts` state from localStorage on mount:

```tsx
const [dmContacts, setDmContacts] = useState(() => {
  return loadDMContacts().map(c => ({
    userId: c.userId,
    userName: c.userName,
    lastMessage: c.lastMessage,
    lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
    unread: c.unread,
  }));
});
```

Update `handleSelectDMUser` to also create a contact entry:

```tsx
const handleSelectDMUser = (userId: string, userName: string) => {
  setSelectedDMUserId(userId);
  setSelectedDMUserName(userName);
  setAppMode('dm');
  const updated = upsertDMContact(userId, userName);
  setDmContacts(updated.map(c => ({
    userId: c.userId,
    userName: c.userName,
    lastMessage: c.lastMessage,
    lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
    unread: c.unread,
  })));
};
```

Update `handleSendDMMessage` to update the contact's last message:

```tsx
const handleSendDMMessage = (content: string) => {
  if (username && content && selectedDMUserId) {
    addDMMessage(username, content);
    const updated = upsertDMContact(selectedDMUserId, selectedDMUserName, content);
    setDmContacts(updated.map(c => ({
      userId: c.userId,
      userName: c.userName,
      lastMessage: c.lastMessage,
      lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
      unread: c.unread,
    })));
  }
};
```

**Step 3: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. Starting a DM via context menu creates a contact entry. Sending a message updates the last message preview.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add DM contact persistence with localStorage"
```

---

### Task 6: Clean up old DMPanel files and update DM button active state CSS

**Files:**
- Delete: `src/Brmble.Web/src/components/DMPanel/DMPanel.tsx`
- Delete: `src/Brmble.Web/src/components/DMPanel/DMPanel.css`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Delete old DMPanel files**

```bash
rm src/Brmble.Web/src/components/DMPanel/DMPanel.tsx
rm src/Brmble.Web/src/components/DMPanel/DMPanel.css
rmdir src/Brmble.Web/src/components/DMPanel
```

**Step 2: Add active state styling for the DM button**

In `src/Brmble.Web/src/components/UserPanel/UserPanel.css`, ensure the `.dm-btn.active` class has a visible active state. Check if the existing `.active` styles on `.user-panel-btn` already handle this. If not, add:

```css
.user-panel-btn.dm-btn.active {
  color: var(--accent-berry);
  background: rgba(212, 20, 90, 0.15);
}
```

**Step 3: Verify no remaining imports of old DMPanel**

Search for any remaining `DMPanel` imports and remove them.

**Step 4: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build with no errors or warnings about missing DMPanel.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove old DMPanel modal and add DM button active state"
```

---

### Task 7: Final integration testing and polish

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (if needed)
- Modify: `src/Brmble.Web/src/App.css` (if needed)

**Step 1: Test the full flow**

1. Build: `cd src/Brmble.Web && npm run build`
2. Run client: `dotnet run --project src/Brmble.Client`
3. Verify:
   - DM button toggles between channel and DM mode with smooth slide animation
   - DM contact list appears on the right with slide-in animation
   - Right-clicking a user in channel tree shows "Send Direct Message" context menu
   - Selecting "Send Direct Message" switches to DM mode with that user selected
   - Sending a DM message shows in the chat and updates the contact list preview
   - Switching back to channel mode preserves channel chat scroll position
   - DM contacts persist across page reloads

**Step 2: Fix any visual issues**

- Ensure the slide transition is smooth (300ms, no jank)
- Ensure the contact list width transition doesn't cause layout shifts
- Ensure the context menu appears at the cursor position and stays within viewport bounds

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete DM view integration with sliding panels and contact list"
```
