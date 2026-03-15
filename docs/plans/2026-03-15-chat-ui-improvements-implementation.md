# Chat UI Improvements Implementation Plan

**Goal:** Implement four chat UI improvements: remove hover highlight, increase avatar size, redesign sticky date divider with cascading dots, and fix unread divider visibility.

**Architecture:** CSS-only changes for #286/#287, IntersectionObserver-based message tracking + CSS for #288, z-index + scroll offset fix for #263. All changes are in the ChatPanel and MessageBubble components.

**Tech Stack:** React, CSS custom properties (token system), IntersectionObserver API

---

### Task 1: Remove Chat Message Hover Highlight (#286)

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css:1-11`

**Step 1: Remove the hover background rule**

In `MessageBubble.css`, remove lines 9-11 (the `.message-bubble:hover` rule) and remove the `transition: background var(--transition-fast)` from line 6 since it only served the hover effect.

The `.message-bubble` rule should become:
```css
.message-bubble {
  display: flex;
  gap: 0.75rem;
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-md);
}
```

Delete the entire block:
```css
.message-bubble:hover {
  background: var(--bg-hover-light);
}
```

**Preserved behavior:**
- `.message-bubble--collapsed:hover .message-hover-time { opacity: 1 }` (line 108) stays untouched
- `.search-active-match` background (line 120) stays untouched

**Step 2: Verify visually**

Run: `cd src/Brmble.Web && npm run dev`
- Hover over messages: no background change
- Hover over collapsed messages: timestamp appears
- Search for a term: active match still highlighted

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "fix(chat): remove hover background highlight on messages (#286)"
```

---

### Task 2: Increase Chat Avatar Size to 48px (#287)

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:119`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css:13-16,91-93`

**Step 1: Update Avatar size prop**

In `MessageBubble.tsx` line 119, change `size={40}` to `size={48}`:
```tsx
<Avatar user={{ name: sender, matrixUserId: senderMatrixUserId, avatarUrl: senderAvatarUrl }} size={48} isMumbleOnly={!isOwnMessage && !senderMatrixUserId} />
```

**Step 2: Update CSS widths**

In `MessageBubble.css`, update `.message-avatar` (lines 13-16):
```css
.message-avatar {
  width: 48px;
  min-width: 48px;
}
```

Update `.message-gutter` (lines 91-93):
```css
.message-gutter {
  width: 48px;
  min-width: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Step 3: Verify visually**

- Avatar is visibly larger, filling the username-to-message-line height
- Collapsed message timestamps are still centered in the gutter
- Multi-line messages don't break layout
- System messages still look correct

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat(chat): increase avatar size to 48px (#287)"
```

---

### Task 3: Redesign Sticky Date Divider with Cascading Dots (#288)

This is the most complex task. It involves: (a) removing the stuck visual distinction, (b) adding a dot indicator element, and (c) tracking hidden message count per section.

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:1,69-71,196-254,507-522`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css:280-294`

#### Step 1: Remove stuck background/shadow from CSS

In `ChatPanel.css`, replace the `.is-stuck` rule (lines 291-294):

**Remove:**
```css
.chat-date-separator-wrapper.is-stuck {
  background-color: var(--bg-primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
```

**Also remove** the transition on line 288 since we no longer animate background/shadow:
```css
  transition: background-color 0.25s ease, box-shadow 0.25s ease;
```

And remove `box-shadow: 0 1px 4px rgba(0, 0, 0, 0);` from line 287.

The `.chat-date-separator-wrapper` rule should become:
```css
.chat-date-separator-wrapper {
  position: sticky;
  top: calc(-1 * var(--space-md));
  z-index: 2;
  margin: 0 calc(-1 * var(--space-lg));
  padding: 0 var(--space-lg);
  background-color: transparent;
}
```

#### Step 2: Add CSS for dot indicator

Add new CSS rules after the `.chat-date-separator-wrapper` block:

```css
/* Cascading dot indicator for sticky date headers */
.chat-date-dots {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs) 0;
  overflow: hidden;
}

.chat-date-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
  opacity: 0.5;
  transition: opacity var(--transition-fast);
}
```

#### Step 3: Add hidden message count tracking in ChatPanel.tsx

Add a new state for tracking hidden messages per section. Add a second IntersectionObserver that watches individual messages within each date group and counts how many are above the viewport.

At the top of the component (after the existing state declarations around line 69), add:

```tsx
const [hiddenCounts, setHiddenCounts] = useState<Map<string, number>>(() => new Map());
const messageObserverRef = useRef<IntersectionObserver | null>(null);
const messageElMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
```

#### Step 4: Add message observer effect

After the existing sticky observer effect (after line 239), add a new effect that creates an IntersectionObserver for tracking which messages are hidden above the viewport within each date section:

```tsx
// --- Hidden message counting for cascading dots ---
// Observe all messages within date groups to count how many are scrolled
// above the viewport. This drives the dot indicator count (max 3).
useEffect(() => {
  const container = messagesContainerRef.current;
  if (!container) return;

  setHiddenCounts(new Map());

  const observer = new IntersectionObserver(
    (entries) => {
      setHiddenCounts(prev => {
        // Build a set of currently-hidden message ids from the tracked elements
        const hiddenSet = new Set<string>();
        // Start with previously known state
        messageElMapRef.current.forEach((el, id) => {
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (rect.bottom < containerRect.top) {
            hiddenSet.add(id);
          }
        });

        // Apply observer updates
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const msgId = el.dataset.msgTrack;
          if (!msgId) continue;
          const containerRect = container.getBoundingClientRect();
          const isAbove = entry.boundingClientRect.bottom < containerRect.top;
          if (!entry.isIntersecting && isAbove) {
            hiddenSet.add(msgId);
          } else {
            hiddenSet.delete(msgId);
          }
        }

        // Count hidden messages per section
        const next = new Map<string, number>();
        for (const section of dateSections) {
          let count = 0;
          for (const item of section.items) {
            if (hiddenSet.has(item.message.id)) count++;
          }
          if (count > 0) next.set(section.dateMessageId, count);
        }

        // Only update if changed
        if (next.size !== prev.size) return next;
        for (const [k, v] of next) {
          if (prev.get(k) !== v) return next;
        }
        return prev;
      });
    },
    { root: container, threshold: 0 }
  );

  messageObserverRef.current = observer;

  // Observe any already-mounted message elements
  messageElMapRef.current.forEach((el) => observer.observe(el));

  return () => {
    observer.disconnect();
    messageObserverRef.current = null;
  };
}, [channelId, dateSections]);
```

#### Step 5: Add message ref callback

After the existing `sentinelRefCallback` (after line 254), add:

```tsx
const messageRefCallback = useCallback((id: string) => (el: HTMLDivElement | null) => {
  const map = messageElMapRef.current;
  const observer = messageObserverRef.current;
  const prev = map.get(id);

  if (prev && observer) observer.unobserve(prev);

  if (el) {
    map.set(id, el);
    if (observer) observer.observe(el);
  } else {
    map.delete(id);
  }
}, []);
```

#### Step 6: Render dot indicator and attach message refs

In the render section, update the sticky date separator wrapper (around line 514) to include the dot indicator:

After the closing `</div>` of `chat-date-separator-wrapper` (line 522), add the dot indicator:

```tsx
<div className={`chat-date-separator-wrapper${stuckSeparators.has(section.dateMessageId) ? ' is-stuck' : ''}`}>
  <Tooltip content={formatFullDate(section.timestamp)}>
  <div className="chat-date-separator">
    <span className="chat-date-separator-label">
      {formatDateSeparator(section.timestamp)}
    </span>
  </div>
  </Tooltip>
</div>
{stuckSeparators.has(section.dateMessageId) && (hiddenCounts.get(section.dateMessageId) ?? 0) > 0 && (
  <div className="chat-date-dots">
    {Array.from({ length: Math.min(3, hiddenCounts.get(section.dateMessageId) ?? 0) }, (_, i) => (
      <div key={i} className="chat-date-dot" />
    ))}
  </div>
)}
```

For message refs, wrap each `<Fragment>` item's content with a tracking div. Around line 527, add `ref={messageRefCallback(item.message.id)}` and `data-msg-track={item.message.id}` to the Fragment's container. The simplest approach is to wrap the existing content:

Change the Fragment render to:
```tsx
<Fragment key={item.message.id}>
  {item.showUnreadDivider && (
    <div className="chat-unread-divider" ref={unreadDividerRef} key={`unread-${item.message.id}`}>
      <span className="chat-unread-divider-label">New Messages</span>
    </div>
  )}
  <div ref={messageRefCallback(item.message.id)} data-msg-track={item.message.id}>
    <MessageBubble
      sender={item.message.sender}
      content={item.message.content}
      timestamp={item.message.timestamp}
      isOwnMessage={!item.message.type && item.message.sender === currentUsername}
      isSystem={item.message.type === 'system'}
      collapsed={!item.isGroupStart}
      html={item.message.html}
      media={item.message.media}
      matrixClient={matrixClient}
      searchQuery={searchQuery}
      isActiveMatch={isActiveMatch}
      messageIndex={msgIndex}
      senderAvatarUrl={lookupAvatar(item.message.sender, item.message.senderMatrixUserId)?.avatarUrl}
      senderMatrixUserId={lookupAvatar(item.message.sender, item.message.senderMatrixUserId)?.matrixUserId}
    />
  </div>
</Fragment>
```

#### Step 7: Verify visually

Run the dev server and test:
- Scroll through a long chat: sticky date divider should be transparent (no background/shadow)
- When stuck with many messages above: 3 dots visible below sticky header
- Scroll up slowly: dots reduce from 3 to 2 to 1 to 0 as messages scroll into view
- When unstuck: no dots, normal inline divider
- Transition between days should be smooth

#### Step 8: Commit

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.css
git commit -m "feat(chat): redesign sticky date divider with cascading dot indicator (#288)"
```

---

### Task 4: Fix Unread Divider Visibility (#263)

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css:322-330`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:183-193`

**Step 1: Add z-index to unread divider**

In `ChatPanel.css`, update `.chat-unread-divider` (lines 323-330) to add `position: relative` and `z-index: 3`:

```css
.chat-unread-divider {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  margin: var(--space-sm) 0;
  user-select: none;
  position: relative;
  z-index: 3;
}
```

**Step 2: Adjust scroll-to-unread offset**

In `ChatPanel.tsx`, update the scroll-to-unread logic (line 188) to use `scrollIntoView` with `block: 'center'` instead of `block: 'start'`, so the unread divider appears in the middle of the viewport rather than at the top where the sticky header might cover it:

Change line 188:
```tsx
unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
```

Also update the ResizeObserver scroll at line 149:
```tsx
unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
```

**Step 3: Verify visually**

- Enter a channel with unread messages
- The "New Messages" divider should be visible and not obscured by the sticky date header
- The divider should appear roughly centered in the viewport

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.css src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "fix(chat): prevent sticky date header from hiding unread divider (#263)"
```

---

### Task 5: Build verification

**Step 1: Run the build**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Clean build with no errors.

**Step 2: Run tests**

```bash
dotnet test
```

Expected: All tests pass.

**Step 3: Final commit (if any fixes needed)**

Only if the build or tests reveal issues that need fixing.
