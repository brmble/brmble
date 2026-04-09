# Discord-Style Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-style reply with inline reply bar and proper Matrix `m.in_reply_to` reply events.

**Architecture:** 
- ReplyHeader component shows above MessageInput when replying
- ChatPanel manages replyState and passes to MessageInput
- MessageInput sends Matrix reply events with proper fallback HTML
- MessageBubble passes messageId through context menu callback

**Tech Stack:** React (TypeScript), Matrix JS SDK

---

## Task 1: Create ReplyHeader component

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/ReplyHeader.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/ReplyHeader.css`

- [ ] **Step 1: Create ReplyHeader.tsx**

```tsx
import { useMemo } from 'react';
import Avatar from '../Avatar/Avatar';
import './ReplyHeader.css';

export interface ReplyState {
  eventId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  html?: string;
  msgType: string;
}

interface ReplyHeaderProps {
  replyState: ReplyState;
  onCancel: () => void;
}

function getPreviewLabel(msgType: string): string {
  switch (msgType) {
    case 'm.image': return '📷 Image';
    case 'm.video': return '🎥 Video';
    case 'm.file': return '📎 File';
    case 'm.audio': return '🎵 Audio';
    default: return '💬 Message';
  }
}

function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '…';
}

export function ReplyHeader({ replyState, onCancel }: ReplyHeaderProps) {
  const preview = useMemo(() => {
    if (replyState.msgType !== 'm.text') {
      return getPreviewLabel(replyState.msgType);
    }
    return truncateText(replyState.content);
  }, [replyState.content, replyState.msgType]);

  return (
    <div className="reply-header">
      <span className="reply-header-label">Replying to</span>
      <div className="reply-header-content">
        <Avatar 
          user={{ name: replyState.sender, matrixUserId: replyState.senderMatrixUserId }} 
          size={20} 
        />
        <span className="reply-header-sender">{replyState.sender}:</span>
        <span className="reply-header-preview">{preview}</span>
      </div>
      <button 
        className="reply-header-cancel" 
        onClick={onCancel}
        aria-label="Cancel reply"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create ReplyHeader.css**

```css
.reply-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-hover, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  margin-bottom: 8px;
}

.reply-header-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #666);
  text-transform: uppercase;
}

.reply-header-content {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.reply-header-sender {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary, #333);
  white-space: nowrap;
}

.reply-header-preview {
  font-size: 13px;
  color: var(--text-secondary, #666);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.reply-header-cancel {
  padding: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted, #666);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reply-header-cancel:hover {
  background: var(--surface-active, #e0e0e0);
  color: var(--text-primary, #333);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ReplyHeader.tsx src/Brmble.Web/src/components/ChatPanel/ReplyHeader.css
git commit -m "feat(chat): create ReplyHeader component"
```

---

## Task 2: Update MessageBubble to pass messageId

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:34` (interface)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:160` (onContextMenu call)

- [ ] **Step 1: Add messageId to onOpenContextMenu prop type**

Find line 34 in MessageBubble.tsx:
```ts
onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string) => void;
```

Replace with:
```ts
onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
```

- [ ] **Step 2: Pass messageId in onContextMenu handler**

Find around line 160:
```tsx
onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId, content);
```

Replace with:
```tsx
onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId, content, messageId);
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx
git commit -m "feat(chat): pass messageId in context menu callback"
```

---

## Task 3: Update ChatPanel to handle reply state and context menu

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:34-35` (props)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:148` (state)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:729-760` (context menu)
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:781` (MessageInput)

- [ ] **Step 1: Update onMessageContextMenu type**

Find line 34-35 in ChatPanel.tsx:
```ts
onMessageContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string) => void;
```

Replace with:
```ts
onMessageContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
```

- [ ] **Step 2: Add reply state to context menu state type**

Find line 148:
```ts
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sender: string; senderMatrixUserId?: string; content?: string } | null>(null);
```

Replace with:
```ts
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sender: string; senderMatrixUserId?: string; content?: string; messageId?: string; msgType?: string } | null>(null);
```

- [ ] **Step 3: Add reply state management**

After line 148, add:
```ts
const [replyState, setReplyState] = useState<{
  eventId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  html?: string;
  msgType: string;
} | null>(null);
```

- [ ] **Step 4: Update context menu callback to pass messageId and msgType**

Find around line 729-731 where onOpenContextMenu is set:
```tsx
onOpenContextMenu={onMessageContextMenu ? (x, y, s, m, c) => {
  if (onMessageContextMenu) onMessageContextMenu(x, y, s, m, c);
  setContextMenu({ x, y, sender: s, senderMatrixUserId: m, content: c });
} : undefined}
```

Replace with:
```tsx
onOpenContextMenu={onMessageContextMenu ? (x, y, s, m, c, msgId, msgType = 'm.text') => {
  if (onMessageContextMenu) onMessageContextMenu(x, y, s, m, c, msgId);
  setContextMenu({ x, y, sender: s, senderMatrixUserId: m, content: c, messageId: msgId, msgType });
} : undefined}
```

- [ ] **Step 5: Add Reply item to context menu items**

Find the ContextMenu items array (around line 741-760). Add Reply between Copy and Send DM:

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
      if (contextMenu.messageId && contextMenu.sender) {
        setReplyState({
          eventId: contextMenu.messageId,
          sender: contextMenu.sender,
          senderMatrixUserId: contextMenu.senderMatrixUserId,
          content: contextMenu.content || '',
          msgType: contextMenu.msgType || 'm.text',
        });
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

- [ ] **Step 6: Pass replyState to MessageInput**

Find the MessageInput component (around line 781). Add replyState and onClearReply:

```tsx
<MessageInput 
  onSend={onSendMessage} 
  placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} 
  mentionableUsers={mentionableUsers} 
  disabled={disabled}
  replyState={replyState}
  onClearReply={() => setReplyState(null)}
/>
```

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(chat): add reply state and context menu item"
```

---

## Task 4: Update MessageInput to display reply bar and send reply events

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx:8-13` (interface)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` (render)
- Create: `src/Brmble.Web/src/utils/replyHelpers.ts` (Matrix reply helpers)

- [ ] **Step 1: Create replyHelpers.ts with Matrix reply formatting**

```ts
// Utility functions for generating Matrix reply fallbacks

/**
 * Strip existing reply fallbacks from a message body
 */
export function stripReplyFallback(body: string): string {
  return body.split('\n').filter(line => !/^> ?/.test(line)).join('\n').trim();
}

/**
 * Generate plain text fallback for a reply
 * Format: "> <sender> first line\n> subsequent lines\n\nreply text"
 */
export function makeReplyFallback(parent: { sender: string; body: string }, replyText: string): string {
  const cleanBody = stripReplyFallback(parent.body);
  const lines = cleanBody.split('\n');
  let fallback = `> <${parent.sender}> ${lines[0]}`;
  for (let i = 1; i < lines.length; ++i) {
    fallback += `\n> ${lines[i]}`;
  }
  return fallback + '\n\n' + replyText;
}

/**
 * Generate HTML fallback for a reply with proper <mx-reply> wrapper
 */
export function makeReplyHtml(
  roomId: string,
  parentEventId: string,
  sender: string,
  senderMatrixUserId: string,
  body: string
): string {
  const senderId = senderMatrixUserId || `@${sender}:unknown`;
  const parentLink = `https://matrix.to/#/${roomId}/${parentEventId}`;
  const senderLink = `https://matrix.to/#/${senderId}`;
  
  // Strip any existing reply fallbacks from body for the preview
  const cleanBody = stripReplyFallback(body);
  // Truncate long content in preview
  const truncatedBody = cleanBody.length > 150 ? cleanBody.slice(0, 150).trim() + '...' : cleanBody;
  
  return `<mx-reply><a href="${parentLink}">In reply to</a><blockquote><a href="${senderLink}">${senderId}</a>${truncatedBody}</blockquote></mx-reply>`;
}

/**
 * Build complete Matrix reply content object
 */
export function buildReplyContent(
  roomId: string,
  parentEventId: string,
  parentSender: string,
  parentSenderMatrixId: string | undefined,
  parentBody: string,
  replyText: string
): {
  msgtype: string;
  body: string;
  format: string;
  formatted_body: string;
  'm.relates_to': {
    'm.in_reply_to': {
      event_id: string;
    };
  };
} {
  const senderId = parentSenderMatrixId || `@${parentSender}:unknown`;
  
  return {
    msgtype: 'm.text',
    body: makeReplyFallback({ sender: senderId, body: parentBody }, replyText),
    format: 'org.matrix.custom.html',
    formatted_body: makeReplyHtml(roomId, parentEventId, parentSender, senderId, parentBody) + replyText,
    'm.relates_to': {
      'm.in_reply_to': {
        event_id: parentEventId,
      },
    },
  };
}
```

- [ ] **Step 2: Add ReplyHeader import and props to MessageInput**

Find the interface (lines 8-13):
```ts
interface MessageInputProps {
  onSend: (content: string, image?: File) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
  disabled?: boolean;
}
```

Replace with:
```ts
import { ReplyState } from './ReplyHeader';

interface MessageInputProps {
  onSend: (content: string, image?: File) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
  disabled?: boolean;
  replyState?: ReplyState | null;
  onClearReply?: () => void;
}
```

- [ ] **Step 3: Pass matrixClient to MessageInput for sending replies**

First, update the interface in ChatPanel.tsx to accept matrixClient. In ChatPanelProps, add:
```ts
matrixClient?: MatrixClient | null;
```

Then pass it to MessageInput:
```tsx
<MessageInput 
  onSend={onSendMessage}
  matrixClient={matrixClient}
  matrixRoomId={matrixRoomId}
  // ... other props
/>
```

Update MessageInputProps to include:
```ts
matrixClient?: MatrixClient | null;
matrixRoomId?: string | null;
```

- [ ] **Step 4: Add ReplyHeader rendering above textarea**

Find the return statement in MessageInput (around line 282). Add ReplyHeader before the input container:

```tsx
return (
  <div className="message-input-container">
    {replyState && onClearReply && (
      <ReplyHeader 
        replyState={replyState} 
        onCancel={onClearReply}
      />
    )}
    {/* rest of the component */}
```

- [ ] **Step 5: Modify handleSend to send Matrix reply**

Find handleSend (around line 215):

```ts
const handleSend = () => {
  if (message.trim() || pendingImage) {
    onSend(message.trim(), pendingImage ?? undefined);
    // ...
  }
};
```

Replace with:
```ts
const handleSend = async () => {
  if (message.trim() || pendingImage) {
    // If there's a replyState, we need to send a Matrix reply
    if (replyState && matrixClient && matrixRoomId) {
      const { buildReplyContent } = await import('../../utils/replyHelpers');
      const content = buildReplyContent(
        matrixRoomId,
        replyState.eventId,
        replyState.sender,
        replyState.senderMatrixUserId,
        replyState.content,
        message.trim()
      );
      await matrixClient.sendEvent(matrixRoomId, 'm.room.message', content);
      if (onClearReply) onClearReply();
    } else {
      onSend(message.trim(), pendingImage ?? undefined);
    }
    setMessage('');
    // ... rest of cleanup
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/utils/replyHelpers.ts src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx
git commit -m "feat(chat): add reply bar UI and Matrix reply events"
```

---

## Task 5: Wire up in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (ChatPanel props)

- [ ] **Step 1: Add matrixClient and matrixRoomId to ChatPanel**

Find where ChatPanel is rendered (around lines 2040 and 2060). Add the props:

```tsx
<ChatPanel
  // ... existing props
  matrixClient={matrixClient}
  matrixRoomId={activeChat?.matrixRoomId}
/>
```

Do this for both ChatPanel instances (channel chat and DM).

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(chat): wire up matrixClient for replies"
```

---

## Task 6: Add ReplyHeader import to MessageInput CSS

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` (import)

- [ ] **Step 1: Add ReplyHeader CSS import**

At the top of MessageInput.tsx, add:
```ts
import './ReplyHeader.css';
```

Wait, ReplyHeader is imported from `./ReplyHeader` so CSS should be in the same file. Actually, the CSS is imported inside ReplyHeader.tsx itself. That's fine.

- [ ] **Step 2: Commit** (if any changes)

---

## Task 7: Test the feature

- [ ] **Step 1: Run dev server**

```bash
cd src/Brmble.Web && npm run dev
# In another terminal:
dotnet run --project src/Brmble.Client
```

- [ ] **Step 2: Test scenarios**

1. Right-click any message → Click "Reply" → Reply bar appears above input
2. Reply bar shows: Avatar + Sender name + preview + [X] button
3. Click [X] → Reply bar disappears
4. Type message and send → Message appears with reply indicator
5. Verify Matrix event has `m.relates_to.m.in_reply_to` property

- [ ] **Step 3: Commit any fixes**

---

## Final: Clean up and push

- [ ] **Push changes**

```bash
git push origin Context-menu-chat-clean
```

---

**Plan complete.** Choose execution approach:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - Execute tasks in this session using executing-plans