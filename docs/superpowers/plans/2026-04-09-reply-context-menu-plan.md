# Reply Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Reply" button to the chat message context menu that pre-populates the message input with quoted text (prefixed with `> `).

**Architecture:** Pass a callback from ChatPanel through App to MessageInput to inject quoted text. Update context menu to include Reply option. Pass messageId through context menu state.

**Tech Stack:** React (TypeScript), existing chat components

---

## Pre-requisite: Create a Worktree

- [ ] **Create a fresh worktree for implementation**

```bash
git worktree add ../brmble-reply-context-menu -b feature/reply-context-menu
cd ../brmble-reply-context-menu
```

---

## Task 1: Add `insertText` prop to MessageInput

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx:8-13` (interface)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx:15` (destructuring)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx:113-117` (handleChange)

- [ ] **Step 1: Add `insertText` prop to interface**

In `MessageInputProps`, add:
```ts
/** Callback to insert text at cursor position or end of input */
insertText?: (text: string) => void;
```

- [ ] **Step 2: Destructure `insertText` prop**

After `disabled` prop, add:
```ts
const { onSend, placeholder = 'Type a message...', mentionableUsers = [], disabled, insertText } = props;
```

- [ ] **Step 3: UseEffect to handle insertText callback**

After line 46 (the focus useEffect), add:
```ts
  // Handle external text insertion (e.g., from reply context menu)
  useEffect(() => {
    if (insertText) {
      // Prepend quoted text to existing message
      setMessage(prev => insertText + prev);
      // Focus and set cursor position after inserted text
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        const pos = insertText.length;
        textareaRef.current?.setSelectionRange(pos, pos);
      });
    }
  }, [insertText]);
```

Note: The dependency should be `[insertText]` - this effect runs once when insertText changes from undefined to a function, which is exactly when we want to insert.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx
git commit -m "feat(chat): add insertText prop to MessageInput"
```

---

## Task 2: Pass `insertText` from ChatPanel to MessageInput

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:15-36` (interface)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:42` (destructuring)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:781` (MessageInput usage)

- [ ] **Step 1: Add `onInsertText` prop to ChatPanelProps**

Add to interface:
```ts
/** Callback to insert text into message input (e.g., from reply context menu) */
onInsertText?: (text: string) => void;
```

- [ ] **Step 2: Destructure `onInsertText`**

In the function component, add to destructuring:
```ts
onInsertText,
```

- [ ] **Step 3: Pass to MessageInput**

Find the MessageInput component (around line 781) and add the prop:
```tsx
<MessageInput 
  onSend={onSendMessage} 
  placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} 
  mentionableUsers={mentionableUsers} 
  disabled={disabled} 
  insertText={onInsertText}
/>
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(chat): pass insertText to MessageInput"
```

---

## Task 3: Add messageId to context menu state and pass from MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:13-35` (interface)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:138` (destructuring)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:157-161` (onContextMenu handler)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:34` (onMessageContextMenu type)

- [ ] **Step 1: Add messageId to MessageBubbleProps**

In the interface, update `onOpenContextMenu`:
```ts
onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
```

- [ ] **Step 2: Pass messageId in onOpenContextMenu call**

In the `onContextMenu` handler (lines 157-161), update:
```tsx
onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId, content, messageId);
```

- [ ] **Step 3: Add messageId to ChatPanel's onMessageContextMenu type**

In ChatPanel.tsx, update the callback type:
```ts
onMessageContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(chat): pass messageId through context menu callbacks"
```

---

## Task 4: Update ChatPanel context menu to include Reply option

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:148` (contextMenu state type)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:729-760` (context menu items)

- [ ] **Step 1: Update contextMenu state type to include messageId**

Find line 148 (the contextMenu useState) and update:
```ts
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sender: string; senderMatrixUserId?: string; content?: string; messageId?: string } | null>(null);
```

- [ ] **Step 2: Update context menu setup to pass messageId**

Find around line 729-731 where contextMenu is set:
```tsx
onOpenContextMenu={onMessageContextMenu ? (x, y, s, m, c, msgId) => {
  if (onMessageContextMenu) onMessageContextMenu(x, y, s, m, c, msgId);
  setContextMenu({ x, y, sender: s, senderMatrixUserId: m, content: c, messageId: msgId });
} : undefined}
```

- [ ] **Step 3: Add Reply item to context menu items**

Find the ContextMenu render (around line 741-760). Currently it has Copy and Send DM. Add Reply between them:

```tsx
items={[
  { 
    type: 'item', 
    label: 'Copy', 
    onClick: () => {
      if (contextMenu.content && onCopyToClipboard) {
        onCopyToClipboard(contextMenu.content);
      }
      setContextMenu(null);
    }
  },
  { 
    type: 'item', 
    label: 'Reply', 
    onClick: () => {
      if (contextMenu.content && onInsertText) {
        const quoted = contextMenu.content.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
        onInsertText(quoted);
      }
      setContextMenu(null);
    }
  },
  { 
    type: 'item', 
    label: 'Send DM', 
    onClick: () => {
      if (onMessageContextMenu) {
        onMessageContextMenu(contextMenu.x, contextMenu.y, contextMenu.sender, contextMenu.senderMatrixUserId);
      }
      setContextMenu(null);
    }
  },
]}
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(chat): add Reply to context menu"
```

---

## Task 5: Wire up in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:2040-2070` (ChatPanel props)

- [ ] **Step 1: Find ChatPanel usages in App.tsx**

Search for where ChatPanel is rendered (around lines 2040 and 2060).

- [ ] **Step 2: Add onInsertText prop to both ChatPanel instances**

Add to both ChatPanel components:
```tsx
onInsertText={handleInsertText}
```

- [ ] **Step 3: Create handleInsertText handler**

Find where other handlers are defined (search for `handleCopyToClipboard`). Add a new handler:

```ts
const handleInsertText = useCallback((text: string) => {
  // This will be called when user clicks Reply in context menu
  // The text will be passed to MessageInput via insertText prop
  // We need to store it in state so it persists
  setMessageInputText(text);
}, []);
```

Actually, looking at the design more carefully - the insertText prop in MessageInput works by using useEffect. So we need to pass a stable callback that returns the text to insert. Let me revise:

Actually, looking at Task 1 Step 3, the useEffect runs when `insertText` changes from undefined to a function. So we need a different approach - let's use a ref or state in ChatPanel to hold the text to insert.

Wait, let me re-read the MessageInput implementation. The useEffect approach is actually problematic because it will run every time the component re-renders with the same function reference.

A better approach: Pass a function that returns the text, or use a separate approach.

Let me revise Task 1 Step 3:

```ts
// Handle external text insertion (e.g., from reply context menu)
useEffect(() => {
  if (insertText && insertText.text) {
    // Prepend quoted text to existing message
    setMessage(prev => insertText.text + prev);
    // Focus and set cursor position after inserted text
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const pos = insertText.text.length;
      textareaRef.current?.setSelectionRange(pos, pos);
    });
    // Clear the insertText after processing
    insertText.clear();
  }
}, [insertText]);
```

This requires a different prop shape. Let me simplify - let's just pass the text directly as a prop that triggers insertion.

Actually, the simplest approach: use a state in ChatPanel that gets passed to MessageInput, and when it changes, MessageInput inserts it and clears the state.

Let me revise the approach:

**Revised approach for Task 1:**

In MessageInput, use a simpler pattern - accept `initialText` prop that when set, prepends to message and clears itself:

```ts
// In MessageInputProps:
initialText?: string;

// In useEffect:
useEffect(() => {
  if (initialText) {
    setMessage(prev => initialText + prev);
    setInitialText(undefined); // This won't work - can't set prop
  }
}, [initialText]);
```

This won't work because you can't set props.

Better approach: Use a callback pattern where ChatPanel passes a function that MessageInput calls:

```ts
// MessageInput:
const insertRef = useRef<((text: string) => void) | null>(null);

// Expose via useImperativeHandle or just pass a setter
// Actually simpler: pass a callback that ChatPanel calls
```

Let me simplify: The cleanest way is to use React's `useImperativeHandle` with `forwardRef`. But that's more complex.

**Simplest solution:** Pass a text string prop `prependText` that when set (non-empty), prepends to message and is cleared:

```ts
// MessageInput.tsx - add to props interface:
prependText?: string;

// Add useEffect:
useEffect(() => {
  if (prependText) {
    setMessage(prev => prependText + prev);
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(prependText.length, prependText.length);
  }
}, [prependText]);
```

This is simple and works. Let's use this approach.

- [ ] **Revise Task 1 Step 1-3 with prependText approach**

In Task 1, change to:

**Step 1:** Add `prependText?: string;` to MessageInputProps

**Step 2:** Add useEffect:
```ts
// Handle external text prepending (e.g., from reply context menu)
useEffect(() => {
  if (prependText) {
    setMessage(prev => prependText + prev);
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(prependText.length, prependText.length);
  }
}, [prependText]);
```

**Step 3:** Commit

---

- [ ] **Step 4: Update Task 2 to use prependText instead of insertText**

In Task 2, change:
- Prop name: `onInsertText` → `onPrependText`
- Pass to MessageInput: `prependText={onPrependText}`

---

- [ ] **Step 5: Update Task 4 context menu handler**

In Task 4 Step 3, change:
```tsx
{ 
  type: 'item', 
  label: 'Reply', 
  onClick: () => {
    if (contextMenu.content && onPrependText) {
      const quoted = contextMenu.content.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
      onPrependText(quoted);
    }
    setContextMenu(null);
  }
}
```

- [ ] **Step 6: Update App.tsx handler**

In Task 5, use `onPrependText` instead of `onInsertText`.

- [ ] **Step 7: Commit all remaining changes**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(chat): wire up reply context menu in App"
```

---

## Task 6: Test the feature

- [ ] **Run the dev server and test**

```bash
cd src/Brmble.Web && npm run dev
# In another terminal:
dotnet run --project src/Brmble.Client
```

- [ ] **Verify:**
1. Right-click on any message (own or others)
2. Click "Reply" in context menu
3. Message input should show quoted text with `> ` prefix
4. Type your reply and send
5. Verify Send DM still works for other users' messages
6. Verify Copy still works

---

## Final: Merge worktree back

- [ ] **Merge feature branch to main**

```bash
git checkout main
git merge feature/reply-context-menu
git push
git worktree remove ../brmble-reply-context-menu
```

---

**Plan complete.** Choose execution approach:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - Execute tasks in this session using executing-plans