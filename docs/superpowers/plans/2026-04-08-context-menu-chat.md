# Context Menu for Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click context menu to chat messages with "Send DM" option.

**Architecture:** Add onContextMenu handler to MessageBubble component, pass event up to ChatPanel which renders the existing ContextMenu component. Reuse existing dmStore.startDM functionality from App.tsx.

**Tech Stack:** React, TypeScript, existing ContextMenu component, existing dmStore

---

## File Structure

- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` — add context menu props and handler
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` — add context menu state and render ContextMenu
- Modify: `src/Brmble.Web/src/App.tsx` — pass callback to ChatPanel

---

### Task 1: Add Context Menu Props to MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`

- [ ] **Step 1: Read MessageBubble.tsx to find the interface**

Read lines 1-35 of `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` to see the MessageBubbleProps interface.

- [ ] **Step 2: Add new props to interface**

Add to MessageBubbleProps interface (after line 33):
```typescript
onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string) => void;
```

- [ ] **Step 3: Add onContextMenu handler to the root div**

In MessageBubble component, find the root div (around line 156). Add onContextMenu prop:
```tsx
onContextMenu={(e) => {
  if (onOpenContextMenu) {
    e.preventDefault();
    onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId);
  }
}}
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx
git commit -m "feat(chat): add context menu props to MessageBubble"
```

---

### Task 2: Add Context Menu State to ChatPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`

- [ ] **Step 1: Read ChatPanel.tsx to find import section**

Read lines 1-15 of `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`.

- [ ] **Step 2: Add ContextMenu import**

Add after line 10:
```typescript
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
```

- [ ] **Step 3: Add onMessageContextMenu prop to ChatPanelProps**

Find ChatPanelProps interface (lines 14-33). Add after line 32:
```typescript
onMessageContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string) => void;
```

- [ ] **Step 4: Add context menu state**

Find the component function (line 39). After the existing useState declarations, add:
```typescript
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sender: string; senderMatrixUserId?: string } | null>(null);
```

- [ ] **Step 5: Pass onContextMenu to MessageBubble**

Find the MessageBubble rendering (around line 702). Add the prop:
```tsx
onOpenContextMenu={onMessageContextMenu ? (x, y, s, m) => {
  // Don't show menu for own messages
  if (s !== currentUsername) {
    setContextMenu({ x, y, sender: s, senderMatrixUserId: m });
  }
} : undefined}
```

- [ ] **Step 6: Add ContextMenu render**

Find where the chat-messages div ends (around line 732). Add before the messagesEndRef div:
```tsx
{contextMenu && (
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={[
      { type: 'item', label: 'Send DM', onClick: () => {
        if (onMessageContextMenu) {
          onMessageContextMenu(contextMenu.x, contextMenu.y, contextMenu.sender, contextMenu.senderMatrixUserId);
        }
        setContextMenu(null);
      }}
    ]}
    onClose={() => setContextMenu(null)}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(chat): add context menu state and render"
```

---

### Task 3: Wire Up Callback in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Find ChatPanel usage in App.tsx**

Search for `<ChatPanel` in App.tsx. Find the component around line 2040.

- [ ] **Step 2: Add onMessageContextMenu prop**

Add to the ChatPanel component props:
```tsx
onMessageContextMenu={handleStartDMFromContextMenu}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(chat): wire up context menu to DM handler"
```

---

### Task 4: Test the Feature

**Files:**
- Test: Manual browser test

- [ ] **Step 1: Build the project**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build completes without errors

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` in Brmble.Web directory, then `dotnet run` in Brmble.Client

- [ ] **Step 3: Verify context menu appears**

1. Connect to a server with users
2. Right-click on a message (not your own)
3. Verify "Send DM" menu appears at cursor position
4. Click "Send DM" and verify DM opens

- [ ] **Step 4: Verify own messages don't show menu**

Right-click on your own message — menu should not appear.

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "test: verify context menu works"
```