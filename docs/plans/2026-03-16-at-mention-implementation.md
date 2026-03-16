# @Mention Feature Implementation Plan

**Goal:** Add an @mention system to chat with typeahead dropdown, styled rendering, and unread mention badges.

**Architecture:** Portal-based autocomplete dropdown in MessageInput, extended linkifyText pipeline for mention rendering in MessageBubble, client-side mention detection feeding into the existing two-badge unread system in ChannelTree. User sources are connected Mumble users + Matrix room members.

**Tech Stack:** React, TypeScript, CSS custom properties (design tokens), matrix-js-sdk, portal rendering

**Design doc:** `docs/plans/2026-03-16-at-mention-design.md`

**UI Guide:** `docs/UI_GUIDE.md` — all styles MUST use CSS custom property tokens. Check against Classic and Retro Terminal themes.

---

### Task 1: Create MentionableUser type and mentionifyText utility

**Files:**
- Create: `src/Brmble.Web/src/utils/mentionifyText.tsx`
- Modify: `src/Brmble.Web/src/types/index.ts:60` (append)

**Step 1: Add MentionableUser type**

In `src/Brmble.Web/src/types/index.ts`, append after line 60:

```ts
export interface MentionableUser {
  displayName: string;
  matrixUserId?: string;
  avatarUrl?: string;
  isOnline: boolean;
}
```

**Step 2: Create mentionifyText utility**

Create `src/Brmble.Web/src/utils/mentionifyText.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Detects @Username patterns in text and wraps them in styled spans.
 * Only matches known usernames to avoid false positives.
 *
 * @param text - Plain text string to process
 * @param knownUsernames - Set of known usernames (case-insensitive matching)
 * @param currentUsername - Current user's display name (for self-mention styling)
 * @returns Array of React nodes with mentions wrapped in styled spans
 */
export function mentionifyText(
  text: string,
  knownUsernames: Set<string>,
  currentUsername?: string,
): ReactNode {
  if (knownUsernames.size === 0) return text;

  // Build regex that matches @username for all known users
  // Sort by length descending so longer names match first
  const sortedNames = Array.from(knownUsernames).sort((a, b) => b.length - a.length);
  const escaped = sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escaped.join('|')})(?=\\s|$|[.,!?;:])`, 'gi');

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedName = match[1];
    const isSelf = currentUsername
      ? matchedName.toLowerCase() === currentUsername.toLowerCase()
      : false;

    parts.push(
      <span
        key={match.index}
        className={`mention${isSelf ? ' mention--self' : ''}`}
      >
        @{matchedName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return text;

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/utils/mentionifyText.tsx
git commit -m "feat: add MentionableUser type and mentionifyText utility"
```

---

### Task 2: Create MentionDropdown component

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.css`

**Reference patterns:**
- Portal rendering: see `src/Brmble.Web/src/components/Tooltip/Tooltip.tsx` and `src/Brmble.Web/src/components/Select/Select.tsx` for portal pattern
- Glass panel styling: `--bg-glass`, `--glass-blur`, `--glass-border`
- Avatar component: `src/Brmble.Web/src/components/Avatar/Avatar.tsx`

**Step 1: Create MentionDropdown.css**

Create `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.css`:

```css
.mention-dropdown {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 300px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-glass);
  backdrop-filter: var(--glass-blur);
  border: var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-elevated);
  padding: var(--space-2xs);
}

.mention-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.mention-dropdown-item:hover,
.mention-dropdown-item--active {
  background: var(--bg-hover);
}

.mention-dropdown-item--offline {
  color: var(--text-muted);
}

.mention-dropdown-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-dropdown-status {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.mention-dropdown-empty {
  padding: var(--space-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}
```

**Step 2: Create MentionDropdown.tsx**

Create `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.tsx`:

```tsx
import { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { MentionableUser } from '../../types';
import Avatar from '../Avatar/Avatar';
import './MentionDropdown.css';

interface MentionDropdownProps {
  query: string;
  users: MentionableUser[];
  activeIndex: number;
  anchorRect: DOMRect | null;
  onSelect: (user: MentionableUser) => void;
  onActiveIndexChange: (index: number) => void;
}

export function MentionDropdown({
  query,
  users,
  activeIndex,
  anchorRect,
  onSelect,
  onActiveIndexChange,
}: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const matches = users.filter(u =>
      u.displayName.toLowerCase().startsWith(q)
    );
    // Online users first, then offline, alphabetical within each group
    matches.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return matches;
  }, [query, users]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('.mention-dropdown-item--active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Clamp active index when filtered list changes
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onActiveIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex, onActiveIndexChange]);

  if (!anchorRect || filtered.length === 0) return null;

  // Position above the anchor
  const style: React.CSSProperties = {
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 4,
  };

  return createPortal(
    <div className="mention-dropdown" style={style} ref={listRef} role="listbox">
      {filtered.map((user, i) => (
        <button
          key={user.displayName}
          className={`mention-dropdown-item${i === activeIndex ? ' mention-dropdown-item--active' : ''}${!user.isOnline ? ' mention-dropdown-item--offline' : ''}`}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(user);
          }}
          onMouseEnter={() => onActiveIndexChange(i)}
        >
          <Avatar
            user={{ name: user.displayName, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }}
            size={20}
            isMumbleOnly={!user.matrixUserId}
          />
          <span className="mention-dropdown-name">{user.displayName}</span>
          {!user.isOnline && <span className="mention-dropdown-status">offline</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MentionDropdown.tsx src/Brmble.Web/src/components/ChatPanel/MentionDropdown.css
git commit -m "feat: add MentionDropdown portal component"
```

---

### Task 3: Integrate mention autocomplete into MessageInput

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` (full rewrite)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.css` (append)

**Step 1: Update MessageInput with mention support**

Modify `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`. The key changes:

1. Add `mentionableUsers` prop of type `MentionableUser[]`
2. Track mention state: `mentionActive`, `mentionQuery`, `mentionActiveIndex`
3. Detect `@` in textarea to activate mention mode
4. Override ArrowUp/ArrowDown/Tab/Enter/Escape when mention dropdown is open
5. On selection, insert `@Username ` at the cursor position

```tsx
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import type { MentionableUser } from '../../types';
import { MentionDropdown } from './MentionDropdown';
import { Tooltip } from '../Tooltip/Tooltip';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (content: string) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
}

export function MessageInput({ onSend, placeholder = 'Type a message...', mentionableUsers = [] }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
  const mentionStartRef = useRef<number>(-1);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [message, resizeTextarea]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [placeholder]);

  const updateMentionState = useCallback((value: string, cursorPos: number) => {
    // Look backwards from cursor for @ that starts a mention
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === '@') {
        // Check if @ is at start or preceded by whitespace
        if (i === 0 || /\s/.test(value[i - 1])) {
          atIndex = i;
        }
        break;
      }
      if (ch === ' ' && i < cursorPos - 1) {
        // Allow spaces in usernames, but break on double space or newline
        continue;
      }
      if (ch === '\n') break;
    }

    if (atIndex >= 0) {
      const query = value.slice(atIndex + 1, cursorPos);
      // Don't activate if there's a space right after @ with no text
      if (query.length === 0 || !query.startsWith(' ')) {
        setMentionActive(true);
        setMentionQuery(query);
        setMentionActiveIndex(0);
        mentionStartRef.current = atIndex;
        // Position dropdown based on wrapper
        if (wrapperRef.current) {
          setMentionAnchorRect(wrapperRef.current.getBoundingClientRect());
        }
        return;
      }
    }

    setMentionActive(false);
    setMentionQuery('');
    mentionStartRef.current = -1;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    updateMentionState(value, e.target.selectionStart ?? value.length);
  }, [updateMentionState]);

  const handleSelect = useCallback((user: MentionableUser) => {
    const start = mentionStartRef.current;
    if (start < 0) return;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? message.length;
    const before = message.slice(0, start);
    const after = message.slice(cursorPos);
    const newMessage = `${before}@${user.displayName} ${after}`;
    setMessage(newMessage);
    setMentionActive(false);
    setMentionQuery('');
    mentionStartRef.current = -1;

    // Set cursor position after the inserted mention
    const newPos = start + user.displayName.length + 2; // @ + name + space
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      }
    });
  }, [message]);

  const handleSend = () => {
    if (message.trim()) {
      onSend(message.trim());
      setMessage('');
      setMentionActive(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && mentionableUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIndex(prev => prev + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        // Only intercept if there are filtered results
        const q = mentionQuery.toLowerCase();
        const hasMatch = mentionableUsers.some(u =>
          u.displayName.toLowerCase().startsWith(q)
        );
        if (hasMatch) {
          e.preventDefault();
          // The dropdown will handle selection via the active index
          // We need to find the filtered user at activeIndex
          const filtered = mentionableUsers
            .filter(u => u.displayName.toLowerCase().startsWith(q))
            .sort((a, b) => {
              if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
              return a.displayName.localeCompare(b.displayName);
            });
          if (filtered.length > 0) {
            const idx = Math.min(mentionActiveIndex, filtered.length - 1);
            handleSelect(filtered[idx]);
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionActive(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close mention dropdown when clicking outside
  useEffect(() => {
    if (!mentionActive) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMentionActive(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mentionActive]);

  return (
    <div className="message-input-container">
      <div className="message-input-wrapper" ref={wrapperRef}>
        <textarea
          ref={textareaRef}
          className="message-input"
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          role="combobox"
          aria-expanded={mentionActive}
          aria-autocomplete="list"
        />
        <Tooltip content="Send message">
        <button
          className="btn btn-primary btn-icon send-button"
          onClick={handleSend}
          disabled={!message.trim()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
        </Tooltip>
      </div>
      {mentionActive && (
        <MentionDropdown
          query={mentionQuery}
          users={mentionableUsers}
          activeIndex={mentionActiveIndex}
          anchorRect={mentionAnchorRect}
          onSelect={handleSelect}
          onActiveIndexChange={setMentionActiveIndex}
        />
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx
git commit -m "feat: integrate mention autocomplete into MessageInput"
```

---

### Task 4: Add mention rendering to MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:12-27,96,130-137`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` (append)

**Step 1: Add mention CSS styles**

Append to `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`:

```css
/* @mention highlighting */
.mention {
  color: var(--accent-primary);
  font-weight: 600;
  background: var(--accent-primary-wash);
  padding: 0 2px;
  border-radius: var(--radius-xs);
}

.mention--self {
  color: var(--accent-secondary);
  background: var(--accent-secondary-wash, color-mix(in srgb, var(--accent-secondary) 15%, transparent));
}
```

**Step 2: Update MessageBubble props and rendering**

In `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`:

1. Add to imports: `import { mentionifyText } from '../../utils/mentionifyText';`
2. Add to `MessageBubbleProps` interface (after `senderMatrixUserId`):
   - `currentUsername?: string;`
   - `knownUsernames?: Set<string>;`
3. Add these props to the destructured params in the component function
4. Update the plain text rendering (line 134-135) to pipe through mentionifyText BEFORE linkifyAndHighlight. The order should be: mentionify first (to get styled spans), then linkify any remaining text segments.

Actually, since both linkifyText and mentionifyText produce React nodes, we need a combined pipeline. The simplest approach: if `knownUsernames` is provided, first run `mentionifyText` to get an array of nodes, then for each string node in the result, run `linkifyAndHighlight`. Create a helper function `processMessageContent` in the file.

Add this helper function before the component:

```tsx
/**
 * Process message content: mentionify, then linkify+highlight remaining text.
 */
function processMessageContent(
  text: string,
  knownUsernames: Set<string> | undefined,
  currentUsername: string | undefined,
  searchQuery: string,
): ReactNode {
  if (!knownUsernames || knownUsernames.size === 0) {
    return linkifyAndHighlight(text, searchQuery);
  }

  const mentionified = mentionifyText(text, knownUsernames, currentUsername);

  // If no mentions found, fall through to linkify
  if (typeof mentionified === 'string') {
    return linkifyAndHighlight(mentionified, searchQuery);
  }

  // mentionifyText returned an array — linkify only string segments
  if (Array.isArray(mentionified)) {
    return mentionified.map((node, i) => {
      if (typeof node === 'string') {
        const result = linkifyAndHighlight(node, searchQuery);
        return typeof result === 'string' ? result : <span key={`lh-${i}`}>{result}</span>;
      }
      return node; // Already a React element (mention span)
    });
  }

  return mentionified;
}
```

Then replace line 134-136:
```tsx
<p className="message-text">
  {processMessageContent(content, knownUsernames, currentUsername, searchQuery || '')}
</p>
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat: add mention rendering to MessageBubble"
```

---

### Task 5: Compute mentionableUsers in ChatPanel and wire props

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:1,14-28,34,623-640,665`

**Step 1: Build mentionableUsers list**

In `ChatPanel.tsx`:

1. Add import: `import type { MentionableUser } from '../../types';`
2. Add a `useMemo` that computes `mentionableUsers` from the `users` prop + Matrix room members:

```tsx
const mentionableUsers = useMemo<MentionableUser[]>(() => {
  const result: MentionableUser[] = [];
  const seen = new Set<string>();

  // Add connected Mumble users first (they're online)
  if (users) {
    for (const u of users) {
      result.push({
        displayName: u.name,
        matrixUserId: u.matrixUserId,
        avatarUrl: u.avatarUrl,
        isOnline: true,
      });
      seen.add(u.name.toLowerCase());
      if (u.matrixUserId) seen.add(u.matrixUserId);
    }
  }

  // Add Matrix room members who aren't already in the list
  if (matrixClient && channelId) {
    // Find the Matrix room ID for this channel
    // channelId is the Mumble channel ID; we need the mapped Matrix room ID
    // The matrixClient prop is the MatrixClient instance, which has getRoom()
    const rooms = matrixClient.getRooms();
    for (const room of rooms) {
      const members = room.getJoinedMembers();
      for (const member of members) {
        const userId = member.userId;
        const displayName = member.name || member.rawDisplayName || userId;
        if (seen.has(userId) || seen.has(displayName.toLowerCase())) continue;
        seen.add(userId);
        seen.add(displayName.toLowerCase());
        result.push({
          displayName,
          matrixUserId: userId,
          isOnline: false,
        });
      }
    }
  }

  return result;
}, [users, matrixClient, channelId]);
```

Note: The Matrix room lookup above iterates all rooms — this is a simplification. For a more precise approach, we'd need the roomMap from credentials. However, since ChatPanel doesn't currently receive the roomMap, iterating all rooms is an acceptable MVP. The room member list is cached by matrix-js-sdk so performance should be fine.

3. Compute `knownUsernames` set for MessageBubble:

```tsx
const knownUsernames = useMemo(() => {
  return new Set(mentionableUsers.map(u => u.displayName));
}, [mentionableUsers]);
```

4. Pass `mentionableUsers` to `MessageInput` (line 665):

Change:
```tsx
<MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />
```
To:
```tsx
<MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} mentionableUsers={mentionableUsers} />
```

5. Pass `currentUsername` and `knownUsernames` to `MessageBubble` (line 623-640):

Add these two new props to each `<MessageBubble>` call:
```tsx
currentUsername={currentUsername}
knownUsernames={knownUsernames}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat: compute mentionableUsers and wire mention props in ChatPanel"
```

---

### Task 6: Add two-badge unread system for mentions in ChannelTree

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:209-219`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css:200-228`

**Step 1: Update ChannelTree badge rendering**

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`, replace lines 209-219:

```tsx
{(() => {
  const unread = channelUnreads?.get(String(channel.id));
  if (!unread) return null;
  return (
    <>
      {unread.notificationCount > 0 && (
        <span className="channel-unread-badge">
          {unread.notificationCount}
        </span>
      )}
      {unread.highlightCount > 0 && (
        <span className="channel-unread-badge channel-unread-badge--mention">
          @{unread.highlightCount}
        </span>
      )}
    </>
  );
})()}
```

**Step 2: Update ChannelTree.css badge styles**

The existing `.channel-unread-badge--mention` already has the red accent styling (`--accent-danger`). We need to ensure both badges can sit side by side. Add a small gap by updating the channel-row layout or adding margin to the mention badge.

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`, after the `.channel-unread-badge--mention` block (around line 219), add:

```css
.channel-unread-badge + .channel-unread-badge--mention {
  margin-left: var(--space-2xs);
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css
git commit -m "feat: add two-badge unread system (white count + red mention)"
```

---

### Task 7: Add client-side mention detection for unread badge

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:75-132`
- Modify: `src/Brmble.Web/src/hooks/useUnreadTracker.ts:11-18,144-175,191-217`

**Step 1: Track mention counts in useUnreadTracker**

This is the most nuanced task. The existing `useUnreadTracker` reads `highlightCount` from Matrix's server-side push rules. Since we're doing client-side `@username` detection, we need to augment this.

In `src/Brmble.Web/src/hooks/useUnreadTracker.ts`:

1. Add a callback prop or a way to pass the current username for client-side mention detection
2. In `countUnreadFromTimeline`, also count messages containing `@currentUsername`
3. Return the client-side highlight count alongside the server count

Modify `countUnreadFromTimeline` (lines 144-175) to accept `currentDisplayName` parameter and count mentions:

```ts
function countUnreadFromTimeline(
  room: Room,
  marker: StoredMarker | null,
  myUserId: string | null,
  currentDisplayName?: string | null,
): { count: number; mentionCount: number } {
  if (!marker) return { count: 0, mentionCount: 0 };

  const timeline = room.getLiveTimeline().getEvents();
  if (timeline.length === 0) return { count: 0, mentionCount: 0 };

  const lastEvent = timeline[timeline.length - 1];
  if (lastEvent.getId() === marker.eventId) return { count: 0, mentionCount: 0 };

  let count = 0;
  let mentionCount = 0;
  const mentionPattern = currentDisplayName
    ? new RegExp(`@${currentDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$|[.,!?;:])`, 'i')
    : null;

  for (let i = timeline.length - 1; i >= 0; i--) {
    const event = timeline[i];
    if (event.getId() === marker.eventId) break;
    if (event.getTs() <= marker.ts) continue;
    if (event.getType() === 'm.room.message' && event.getSender() !== myUserId) {
      count++;
      if (mentionPattern) {
        const body = (event.getContent() as { body?: string }).body ?? '';
        if (mentionPattern.test(body)) {
          mentionCount++;
        }
      }
    }
  }

  return { count, mentionCount };
}
```

Update `buildRoomUnread` to use the new return type and pass `currentDisplayName`. The `useUnreadTracker` function signature needs a new parameter `currentDisplayName: string | null`.

Update `RoomUnreadState` to include the client-side mention count (or reuse `highlightCount` with the max of server-side and client-side).

In `buildRoomUnread`, update the client-count path:

```ts
const { count: clientCount, mentionCount } = countUnreadFromTimeline(room, localMarker, myUserId, currentDisplayName);
return {
  notificationCount: clientCount,
  highlightCount: Math.max(serverHighlight, mentionCount),
  fullyReadEventId,
};
```

**Step 2: Update useUnreadTracker signature**

Add `currentDisplayName` parameter:

```ts
export function useUnreadTracker(
  client: MatrixClient | null,
  dmRoomIds: Set<string>,
  activeRoomId: string | null,
  currentDisplayName?: string | null,
): UnreadTracker {
```

Pass it through to `buildRoomUnread` and `countUnreadFromTimeline`.

**Step 3: Update App.tsx to pass currentDisplayName to useUnreadTracker**

Find the `useUnreadTracker` call in `App.tsx` and add the username parameter. The username is already available in App.tsx state.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/hooks/useUnreadTracker.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add client-side @mention detection for unread badges"
```

---

### Task 8: Build and verify

**Step 1: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

Fix any TypeScript errors.

**Step 2: Visual verification**

Run the dev server and verify:
1. Typing `@` in chat shows the dropdown
2. Typeahead filters correctly (prefix match)
3. Tab/Enter completes the mention
4. Mentions are styled in sent messages (`.mention` class)
5. Self-mentions use `--accent-secondary`
6. Channel badges show white + red when applicable
7. Test both Classic and Retro Terminal themes

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete @mention feature implementation (#283)"
```
