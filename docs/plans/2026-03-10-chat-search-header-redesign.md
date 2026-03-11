# Chat Search & Header Redesign Implementation Plan

> **Implementation note:** Follow this plan task-by-task when implementing the feature.

**Goal:** Replace the chat header icon with a search toggle, and implement client-side message search with prev/next navigation and highlighting.

**Architecture:** Client-side substring search over the already-loaded `messages` array. Search bar slides in below the chat header when toggled. Messages are filtered in-place with match highlighting. Prev/next buttons scroll between matches bottom-to-top (newest first). No Matrix API calls needed.

**Tech Stack:** React, TypeScript, CSS custom properties (theme tokens)

**Issues:** #219, #153

---

### Task 1: Replace header icon with search toggle button

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:36,200-212`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css:72-86`

**Step 1: Add search state to ChatPanel**

Add to the state declarations (after line 36):
```tsx
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
```

**Step 2: Replace header-right content**

Replace lines 200-212 (the `{!isDM && ...}` block) with a search toggle button visible on ALL views (channel + DM):
```tsx
<div className="chat-header-right">
  <Tooltip content={searchOpen ? 'Close search' : 'Search messages'}>
    <button
      className={`chat-search-toggle${searchOpen ? ' active' : ''}`}
      onClick={() => {
        setSearchOpen(prev => !prev);
        if (searchOpen) setSearchQuery('');
      }}
      aria-label={searchOpen ? 'Close search' : 'Search messages'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </button>
  </Tooltip>
</div>
```

**Step 3: Add CSS for search toggle button**

Replace `.chat-header-right` and `.user-count-badge` styles with:
```css
.chat-header-right {
  display: flex;
  align-items: center;
}

.chat-search-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.chat-search-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chat-search-toggle.active {
  background: var(--bg-hover);
  color: var(--accent-primary);
}

.chat-search-toggle:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

**Step 4: Verify build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```
feat: replace chat header user-count badge with search toggle button

Closes #219
```

---

### Task 2: Add search bar UI below header

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:213`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`

**Step 1: Add search bar refs**

Add refs for the search input and match tracking:
```tsx
const searchInputRef = useRef<HTMLInputElement>(null);
const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
```

**Step 2: Compute matches**

Add a `useMemo` to find matching message indices:
```tsx
const searchMatches = useMemo(() => {
  if (!searchQuery.trim()) return [];
  const query = searchQuery.toLowerCase();
  const indices: number[] = [];
  messages.forEach((msg, i) => {
    if (msg.content && msg.content.toLowerCase().includes(query)) {
      indices.push(i);
    }
  });
  return indices;
}, [messages, searchQuery]);
```

**Step 3: Add search bar JSX after the chat-header div**

```tsx
{searchOpen && (
  <div className="chat-search-bar">
    <div className="chat-search-input-wrapper">
      <svg className="chat-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={searchInputRef}
        className="chat-search-input"
        type="text"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setCurrentMatchIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSearchOpen(false);
            setSearchQuery('');
          } else if (e.key === 'Enter') {
            if (e.shiftKey) handleSearchPrev();
            else handleSearchNext();
          }
        }}
        placeholder="Search messages..."
      />
      {searchQuery && (
        <span className="chat-search-count">
          {searchMatches.length > 0 ? `${currentMatchIndex + 1} of ${searchMatches.length}` : 'No results'}
        </span>
      )}
    </div>
    <div className="chat-search-nav">
      <Tooltip content="Previous match (Shift+Enter)">
        <button
          className="chat-search-nav-btn"
          onClick={handleSearchPrev}
          disabled={searchMatches.length === 0 || currentMatchIndex >= searchMatches.length - 1}
          aria-label="Previous match"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
      </Tooltip>
      <Tooltip content="Next match (Enter)">
        <button
          className="chat-search-nav-btn"
          onClick={handleSearchNext}
          disabled={searchMatches.length === 0 || currentMatchIndex <= 0}
          aria-label="Next match"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </Tooltip>
      <Tooltip content="Close search (Esc)">
        <button
          className="chat-search-nav-btn"
          onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
          aria-label="Close search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </Tooltip>
    </div>
  </div>
)}
```

**Step 4: Add navigation handlers and auto-focus**

```tsx
const handleSearchPrev = useCallback(() => {
  setCurrentMatchIndex(prev => Math.min(prev + 1, searchMatches.length - 1));
}, [searchMatches.length]);

const handleSearchNext = useCallback(() => {
  setCurrentMatchIndex(prev => Math.max(prev - 1, 0));
}, []);
```

Auto-focus when search opens:
```tsx
useEffect(() => {
  if (searchOpen && searchInputRef.current) {
    searchInputRef.current.focus();
  }
}, [searchOpen]);
```

Reset search on channel switch:
```tsx
useEffect(() => {
  setSearchOpen(false);
  setSearchQuery('');
  setCurrentMatchIndex(0);
}, [channelId]);
```

**Step 5: Add search bar CSS**

```css
.chat-search-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-lg);
  background: var(--bg-glass);
  backdrop-filter: var(--glass-blur);
  border-bottom: var(--glass-border);
}

.chat-search-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  background: var(--bg-deep);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2xs) var(--space-sm);
  transition: border-color var(--transition-fast);
}

.chat-search-input-wrapper:focus-within {
  border-color: var(--accent-primary);
}

.chat-search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.chat-search-input {
  flex: 1;
  background: transparent;
  border: none;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-primary);
  padding: var(--space-2xs) 0;
}

.chat-search-input::placeholder {
  color: var(--text-muted);
}

.chat-search-input:focus {
  outline: none;
}

.chat-search-count {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  padding-left: var(--space-xs);
}

.chat-search-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.chat-search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.chat-search-nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chat-search-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.chat-search-nav-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

**Step 6: Verify build**

Run: `cd src/Brmble.Web && npm run build`

**Step 7: Commit**

```
feat: add search bar UI with prev/next navigation below chat header
```

---

### Task 3: Scroll-to-match and highlight integration

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:11,23,59-64`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`

**Step 1: Add scroll-to-match effect in ChatPanel**

The match indices point into the original `messages` array. We need to scroll to the message DOM element. Add `data-message-index` attributes to message bubbles and scroll to the active match:

```tsx
useEffect(() => {
  if (searchMatches.length === 0 || !messagesContainerRef.current) return;
  const msgIndex = searchMatches[searchMatches.length - 1 - currentMatchIndex];
  const target = messagesContainerRef.current.querySelector(`[data-message-index="${msgIndex}"]`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, [currentMatchIndex, searchMatches]);
```

Note: matches are ordered oldest→newest. `currentMatchIndex=0` means the newest match (last element). So we access `searchMatches[searchMatches.length - 1 - currentMatchIndex]`.

**Step 2: Pass searchQuery and activeMessageIndex to MessageBubble**

In the grouped.map render, pass additional props:
```tsx
<MessageBubble
  ...existing props...
  searchQuery={searchQuery}
  isActiveMatch={searchMatches.length > 0 && messages.indexOf(item.message) === searchMatches[searchMatches.length - 1 - currentMatchIndex]}
  messageIndex={messages.indexOf(item.message)}
/>
```

**Step 3: Update MessageBubble to accept and render highlights**

Add to props interface:
```tsx
searchQuery?: string;
isActiveMatch?: boolean;
messageIndex?: number;
```

Add a highlight helper function:
```tsx
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(<mark key={idx} className="search-highlight">{text.slice(idx, idx + query.length)}</mark>);
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}
```

Update the message-text rendering to use highlights for non-HTML messages:
```tsx
{content && (
  html ? (
    <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
  ) : (
    <p className="message-text">
      {searchQuery ? highlightText(content, searchQuery) : linkifyText(content)}
    </p>
  )
)}
```

Add `data-message-index` and active-match class to the bubble div:
```tsx
<div className={classes.join(' ')} data-message-index={messageIndex}>
```

Add `.search-active-match` class when `isActiveMatch` is true.

**Step 4: Add highlight CSS**

```css
.search-highlight {
  background: var(--accent-primary);
  color: var(--bg-deep);
  border-radius: 2px;
  padding: 0 1px;
}

.search-active-match {
  background: var(--bg-hover);
  box-shadow: inset 3px 0 0 var(--accent-primary);
}
```

**Step 5: Verify build**

Run: `cd src/Brmble.Web && npm run build`

**Step 6: Commit**

```
feat: add search highlighting and scroll-to-match navigation

Closes #153
```
