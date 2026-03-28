# Image Upload/Sending Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to send images in channel chat via paste and drag-and-drop, with optimistic display, error/retry, and dual Matrix + Mumble delivery.

**Architecture:** Frontend-only approach. Images are uploaded to the Matrix media repo via `matrix-js-sdk` `uploadContent()` and sent as `m.image` events. Simultaneously, images are base64-encoded and sent to Mumble via the WebView2 bridge. Optimistic messages appear immediately in chat; failures show a retry overlay.

**Tech Stack:** React, TypeScript, matrix-js-sdk, WebView2 bridge, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-image-upload-design.md`
**Branch:** `feature/image-upload-200`
**Issue:** #200

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/Brmble.Web/src/utils/parseMessageMedia.ts` | Modify | Export `MAX_SIZE_BYTES` and `ALLOWED_MIMETYPES` constants |
| `src/Brmble.Web/src/types/index.ts` | Modify | Add `error?: boolean` to `ChatMessage` |
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Modify | Add `sendImageMessage()` and `uploadContent()` |
| `src/Brmble.Web/src/utils/imageUpload.ts` | Create | Standalone utilities: `validateImageFile()`, `encodeForMumble()` |
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` | Modify | Paste/drop handlers, preview strip, extended `onSend` signature |
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.css` | Modify | Preview strip styling, drag-over feedback |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` | Modify | Widen `onSendMessage` prop, add `onDismissMessage` prop, wire to MessageBubble |
| `src/Brmble.Web/src/App.tsx` | Modify | Extend `handleSendMessage` for image upload flow, add `handleDismissMessage` |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` | Modify | Add `error`, `pending`, `messageId` props, error overlay with dismiss |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` | Modify | Pending and error overlay styling |

---

### Task 1: Export validation constants

**Files:**
- Modify: `src/Brmble.Web/src/utils/parseMessageMedia.ts:3-4`

- [ ] **Step 1: Export the existing constants**

Change lines 3-4 from:
```ts
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
```
to:
```ts
export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
```

- [ ] **Step 2: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors (existing usages within the file are unaffected)

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/utils/parseMessageMedia.ts
git commit -m "refactor: export image validation constants from parseMessageMedia"
```

---

### Task 2: Add error field to ChatMessage type

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:52`

- [ ] **Step 1: Add error field to ChatMessage**

After the `pending?: boolean;` line (line 52) in the `ChatMessage` interface, add:
```ts
  error?: boolean;
```

The interface currently has no `error` field. The `error?: string` that exists on `ServiceStatus` (line 63) is a different interface entirely.

- [ ] **Step 2: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add error field to ChatMessage type for failed sends"
```

---

### Task 3: Add sendImageMessage and uploadContent to useMatrixClient

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

- [ ] **Step 1: Add the sendImageMessage function**

After the existing `sendMessage` callback (around line 393-398), add:
```ts
const sendImageMessage = useCallback(async (channelId: string, file: File, mxcUrl: string) => {
  if (!credentials || !clientRef.current) return;
  const roomId = credentials.roomMap[channelId];
  if (!roomId) return;
  await clientRef.current.sendMessage(roomId, {
    msgtype: MsgType.Image,
    url: mxcUrl,
    body: file.name,
    info: {
      mimetype: file.type,
      size: file.size,
    },
  });
}, [credentials]);
```

- [ ] **Step 2: Add uploadContent wrapper**

After `sendImageMessage`, add:
```ts
const uploadContent = useCallback(async (file: File): Promise<string> => {
  if (!clientRef.current) throw new Error('Matrix client not initialized');
  const response = await clientRef.current.uploadContent(file, {
    type: file.type,
    name: file.name,
  });
  return response.content_uri;
}, []);
```

- [ ] **Step 3: Export the new functions in the return statement**

Update the return statement (line 528) to include both new functions:
```ts
return { messages, sendMessage, sendImageMessage, uploadContent, fetchHistory, dmMessages, dmRoomMap,
         dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
         fetchAvatarUrl, client };
```

- [ ] **Step 4: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts
git commit -m "feat: add sendImageMessage and uploadContent to useMatrixClient"
```

---

### Task 4: Create image upload utilities

**Files:**
- Create: `src/Brmble.Web/src/utils/imageUpload.ts`

These are standalone pure functions (not a hook), used by both MessageInput (validation) and App.tsx (Mumble encoding).

- [ ] **Step 1: Create the utility file**

```ts
import { MAX_SIZE_BYTES, ALLOWED_MIMETYPES } from './parseMessageMedia';

export interface ValidationError {
  type: 'invalid-type' | 'too-large' | 'empty';
  message: string;
}

export function validateImageFile(file: File): ValidationError | null {
  if (file.size === 0) {
    return { type: 'empty', message: '' };
  }
  if (!ALLOWED_MIMETYPES.includes(file.type)) {
    return { type: 'invalid-type', message: 'Only PNG, JPEG, GIF, and WebP images are supported' };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { type: 'too-large', message: 'Image must be under 5MB' };
  }
  return null;
}

export function encodeForMumble(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(`<img src="${dataUrl}" />`);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 2: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/utils/imageUpload.ts
git commit -m "feat: add image validation and Mumble encoding utilities"
```

---

### Task 5: Add paste/drop handlers and preview strip to MessageInput

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`

- [ ] **Step 1: Update MessageInput props and add image state**

Update the props interface:
```ts
interface MessageInputProps {
  onSend: (content: string, image?: File) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
  disabled?: boolean;
}
```

Add imports at the top of the file:
```ts
import { validateImageFile } from '../../utils/imageUpload';
```

Add state inside the component, after existing state declarations:
```ts
const [pendingImage, setPendingImage] = useState<File | null>(null);
const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
const [validationError, setValidationError] = useState<string | null>(null);
const [isDragOver, setIsDragOver] = useState(false);
const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: Add image staging helper**

```ts
const stageImage = useCallback((file: File) => {
  const error = validateImageFile(file);
  if (error) {
    if (error.type === 'empty') return; // silently ignore
    setValidationError(error.message);
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => setValidationError(null), 3000);
    return;
  }
  // Revoke previous preview URL
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  setPendingImage(file);
  setImagePreviewUrl(URL.createObjectURL(file));
  setValidationError(null);
}, [imagePreviewUrl]);

const clearImage = useCallback(() => {
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  setPendingImage(null);
  setImagePreviewUrl(null);
  setValidationError(null);
}, [imagePreviewUrl]);

// Cleanup on unmount
useEffect(() => {
  return () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
  };
}, [imagePreviewUrl]);
```

- [ ] **Step 3: Add paste handler**

```ts
const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault();
      const file = items[i].getAsFile();
      if (file) stageImage(file);
      return;
    }
  }
  // If no image found, let the default paste behavior handle text
}, [stageImage]);
```

- [ ] **Step 4: Add drag-and-drop handlers**

```ts
const handleDragOver = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files')) {
    setIsDragOver(true);
  }
}, []);

const handleDragLeave = useCallback((e: React.DragEvent) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
    setIsDragOver(false);
  }
}, []);

const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  setIsDragOver(false);
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('image/')) {
    stageImage(file);
  }
}, [stageImage]);
```

- [ ] **Step 5: Update handleSend to include image**

Replace the existing `handleSend`:
```ts
const handleSend = () => {
  if (message.trim() || pendingImage) {
    onSend(message.trim(), pendingImage ?? undefined);
    setMessage('');
    setMentionActive(false);
    setPendingImage(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
  }
};
```

- [ ] **Step 6: Update handleKeyDown for Escape**

Inside `handleKeyDown`, add this block before the existing `if (e.key === 'Enter' && !e.shiftKey)` check (around line 176):
```ts
if (e.key === 'Escape' && pendingImage) {
  e.preventDefault();
  clearImage();
  return;
}
```

- [ ] **Step 7: Update the send button disabled state**

Change the send button from:
```tsx
disabled={disabled || !message.trim()}
```
to:
```tsx
disabled={disabled || (!message.trim() && !pendingImage)}
```

- [ ] **Step 8: Update the JSX to add handlers and preview strip**

Add `onPaste` to the textarea:
```tsx
<textarea
  ref={textareaRef}
  className="message-input"
  value={message}
  onChange={handleChange}
  onKeyDown={handleKeyDown}
  onSelect={handleSelect}
  onPaste={handlePaste}
  placeholder={disabled ? 'User is offline' : placeholder}
  disabled={disabled}
  rows={1}
  ...existing aria props...
/>
```

Add drag handlers to `.message-input-wrapper` div:
```tsx
<div
  className={`message-input-wrapper${isDragOver ? ' drag-over' : ''}`}
  ref={wrapperRef}
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
>
```

Add preview strip inside `.message-input-container`, before `.message-input-wrapper`:
```tsx
<div className="message-input-container">
  {pendingImage && imagePreviewUrl && (
    <div className="image-preview-strip">
      <img
        src={imagePreviewUrl}
        alt={pendingImage.name}
        className="image-preview-thumbnail"
      />
      <div className="image-preview-info">
        <span className="image-preview-name">{pendingImage.name}</span>
        <span className="image-preview-size">
          {(pendingImage.size / 1024).toFixed(0)} KB
        </span>
      </div>
      <button
        className="image-preview-remove"
        onClick={clearImage}
        aria-label="Remove image"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )}
  {validationError && (
    <div className="image-validation-error">{validationError}</div>
  )}
  <div className={`message-input-wrapper${isDragOver ? ' drag-over' : ''}`} ...>
    ...existing content...
  </div>
</div>
```

- [ ] **Step 9: Add CSS for preview strip and drag-over**

Append to `MessageInput.css`:
```css
.image-preview-strip {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-xs);
}

.image-preview-thumbnail {
  height: 64px;
  max-width: 120px;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

.image-preview-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.image-preview-name {
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-preview-size {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.image-preview-remove {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--space-xs);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-preview-remove:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.message-input-wrapper.drag-over {
  border-color: var(--accent-primary);
  background: var(--accent-primary-subtle, rgba(99, 102, 241, 0.05));
}

.image-validation-error {
  font-size: var(--text-sm);
  color: var(--status-error);
  padding: var(--space-xs) var(--space-sm);
}
```

- [ ] **Step 10: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx src/Brmble.Web/src/components/ChatPanel/MessageInput.css
git commit -m "feat: add paste/drop image handlers and preview strip to MessageInput"
```

---

### Task 6: Update prop chain through ChatPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`

- [ ] **Step 1: Update ChatPanel props type**

In the `ChatPanelProps` interface (around line 14-32), change:
```ts
onSendMessage: (content: string) => void;
```
to:
```ts
onSendMessage: (content: string, image?: File) => void;
onDismissMessage?: (messageId: string) => void;
```

- [ ] **Step 2: Destructure the new prop**

Add `onDismissMessage` to the destructuring where the component receives its props.

- [ ] **Step 3: Pass onDismissMessage to MessageBubble**

Where `MessageBubble` is rendered in the message list, add the new props:
```tsx
<MessageBubble
  ...existing props...
  messageId={msg.id}
  pending={msg.pending}
  error={msg.error}
  onDismiss={onDismissMessage}
/>
```

- [ ] **Step 4: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: May have errors until Task 7 and 8 are done — that's OK, verify after Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat: widen onSendMessage prop, add onDismissMessage to ChatPanel"
```

---

### Task 7: Implement image send flow in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add imports**

Add at the top of App.tsx:
```ts
import { encodeForMumble } from './utils/imageUpload';
```

Check if `ChatMessage` is already imported from `./types` — add it if not.

- [ ] **Step 2: Update handleSendMessage**

Replace the entire `handleSendMessage` function. Note: `channelId` is captured in a local const at the top to prevent stale closure issues in async callbacks.

```ts
const handleSendMessage = (content: string, image?: File) => {
  if (!username || (!content && !image)) return;

  const channelId = currentChannelId;
  if (!channelId) return;

  const isMatrixChannel = channelId !== 'server-root' &&
    matrixCredentials?.roomMap[channelId] !== undefined;

  // Send text content (existing behavior)
  if (content) {
    if (!isMatrixChannel) {
      addMessage(username, content);
    }

    if (channelId === 'server-root') {
      bridge.send('voice.sendMessage', { message: content, channelId: 0 });
    } else {
      bridge.send('voice.sendMessage', { message: content, channelId: Number(channelId) });
      if (isMatrixChannel) {
        matrixClient.sendMessage(channelId, content).catch(console.error);
      }
    }
  }

  // Send image
  if (image) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const objectUrl = URL.createObjectURL(image);

    // Optimistic message
    const optimisticMsg: ChatMessage = {
      id: tempId,
      channelId,
      sender: username,
      content: '',
      timestamp: new Date(),
      pending: true,
      media: [{
        type: image.type === 'image/gif' ? 'gif' : 'image',
        url: objectUrl,
        mimetype: image.type,
        size: image.size,
      }],
    };

    setMessages(prev => {
      const existing = prev.get(channelId) ?? [];
      return new Map(prev).set(channelId, [...existing, optimisticMsg]);
    });

    // Mumble path (fire and forget)
    encodeForMumble(image).then(imgTag => {
      if (channelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: imgTag, channelId: 0 });
      } else {
        bridge.send('voice.sendMessage', { message: imgTag, channelId: Number(channelId) });
      }
    }).catch(err => console.error('Mumble image send failed:', err));

    // Matrix path
    if (isMatrixChannel) {
      matrixClient.uploadContent(image)
        .then(mxcUrl => matrixClient.sendImageMessage(channelId, image, mxcUrl))
        .then(() => {
          // Remove optimistic message (Matrix sync will add the real one)
          setMessages(prev => {
            const existing = prev.get(channelId) ?? [];
            return new Map(prev).set(channelId, existing.filter(m => m.id !== tempId));
          });
          URL.revokeObjectURL(objectUrl);
        })
        .catch(err => {
          console.error('Matrix image upload failed:', err);
          setMessages(prev => {
            const existing = prev.get(channelId) ?? [];
            return new Map(prev).set(channelId, existing.map(m =>
              m.id === tempId ? { ...m, pending: false, error: true } : m
            ));
          });
        });
    } else {
      // No Matrix — keep optimistic message, clear pending
      setMessages(prev => {
        const existing = prev.get(channelId) ?? [];
        return new Map(prev).set(channelId, existing.map(m =>
          m.id === tempId ? { ...m, pending: false } : m
        ));
      });
    }
  }

  setUnreadCount(0);
  updateBadge(0, hasPendingInvite);
};
```

- [ ] **Step 3: Add handleDismissMessage**

After `handleSendMessage`, add:
```ts
const handleDismissMessage = (messageId: string) => {
  const channelId = currentChannelId;
  if (!channelId) return;
  setMessages(prev => {
    const existing = prev.get(channelId) ?? [];
    return new Map(prev).set(channelId, existing.filter(m => m.id !== messageId));
  });
};
```

- [ ] **Step 4: Pass handleDismissMessage to ChatPanel**

Where `<ChatPanel>` is rendered, add the new prop:
```tsx
<ChatPanel
  ...existing props...
  onDismissMessage={handleDismissMessage}
/>
```

- [ ] **Step 5: Verify build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: May have errors until Task 8 is done — verify after Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: implement image send flow with optimistic display and dual-path delivery"
```

---

### Task 8: Add error overlay to MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`

MessageBubble uses flat props (not a `message` object). We add individual props for the new fields.

- [ ] **Step 1: Add new props to MessageBubbleProps**

Add to the existing `MessageBubbleProps` interface:
```ts
messageId?: string;
pending?: boolean;
error?: boolean;
onDismiss?: (messageId: string) => void;
```

Destructure them in the component function signature alongside existing props.

- [ ] **Step 2: Add pending class to the message bubble container**

Find where the root div gets its className. Add conditional classes:
```tsx
className={`message-bubble${pending ? ' message-bubble--pending' : ''}${error ? ' message-bubble--error' : ''}`}
```

(Adjust to match the existing className pattern — may need to append to an existing template string.)

- [ ] **Step 3: Add error overlay JSX**

After the existing media rendering block (`{media && media.length > 0 && ...}`), add:
```tsx
{error && messageId && (
  <div className="message-error-overlay">
    <span className="message-error-text">Failed to send</span>
    <div className="message-error-actions">
      {onDismiss && (
        <button
          className="message-error-btn message-error-dismiss"
          onClick={() => onDismiss(messageId)}
          aria-label="Dismiss failed message"
        >
          Dismiss
        </button>
      )}
    </div>
  </div>
)}
```

Note: Retry is omitted for v1 (threading the retry logic through the component tree is complex). Dismiss-only for now. Retry can be added as a follow-up.

- [ ] **Step 4: Add CSS to MessageBubble.css**

Append to `MessageBubble.css`:
```css
.message-bubble--pending {
  opacity: 0.6;
}

.message-error-overlay {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-top: var(--space-xs);
  background: var(--status-error-subtle, rgba(239, 68, 68, 0.1));
  border-radius: var(--radius-sm);
  border: 1px solid var(--status-error);
}

.message-error-text {
  font-size: var(--text-sm);
  color: var(--status-error);
  flex: 1;
}

.message-error-actions {
  display: flex;
  gap: var(--space-xs);
}

.message-error-btn {
  background: none;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.message-error-dismiss {
  color: var(--text-muted);
}

.message-error-dismiss:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}
```

- [ ] **Step 5: Verify full build passes**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No errors (all tasks 1-8 are now complete)

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat: add pending state and error overlay with dismiss to MessageBubble"
```

---

### Task 9: Unit and component tests

**Files:**
- Create: `src/Brmble.Web/src/__tests__/utils/imageUpload.test.ts`
- Create: `src/Brmble.Web/src/__tests__/components/MessageInput.test.tsx`

- [ ] **Step 1: Check existing test setup**

Run: `(cd src/Brmble.Web && ls vitest.config.* vite.config.* package.json)`

Check if Vitest is already configured. Look for test scripts in `package.json`. If not set up, add `vitest` as a dev dependency and configure.

- [ ] **Step 2: Write unit tests for validateImageFile**

Create `src/Brmble.Web/src/__tests__/utils/imageUpload.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateImageFile, encodeForMumble } from '../../utils/imageUpload';

describe('validateImageFile', () => {
  it('accepts valid PNG file', () => {
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid JPEG file', () => {
    const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid GIF file', () => {
    const file = new File(['data'], 'test.gif', { type: 'image/gif' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('accepts valid WebP file', () => {
    const file = new File(['data'], 'test.webp', { type: 'image/webp' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('rejects unsupported file type', () => {
    const file = new File(['data'], 'test.bmp', { type: 'image/bmp' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('invalid-type');
  });

  it('rejects non-image file', () => {
    const file = new File(['data'], 'test.pdf', { type: 'application/pdf' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('invalid-type');
  });

  it('rejects file over 5MB', () => {
    const data = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([data], 'big.png', { type: 'image/png' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('too-large');
  });

  it('accepts file exactly at 5MB', () => {
    const data = new Uint8Array(5 * 1024 * 1024);
    const file = new File([data], 'exact.png', { type: 'image/png' });
    expect(validateImageFile(file)).toBeNull();
  });

  it('returns empty type for 0-byte file', () => {
    const file = new File([], 'empty.png', { type: 'image/png' });
    const result = validateImageFile(file);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('empty');
  });
});

describe('encodeForMumble', () => {
  it('wraps file as base64 img tag', async () => {
    const file = new File(['hello'], 'test.png', { type: 'image/png' });
    const result = await encodeForMumble(file);
    expect(result).toMatch(/^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" \/>$/);
  });
});
```

- [ ] **Step 3: Run unit tests**

Run: `(cd src/Brmble.Web && npx vitest run src/__tests__/utils/imageUpload.test.ts)`
Expected: All tests pass

- [ ] **Step 4: Commit tests**

```bash
git add src/Brmble.Web/src/__tests__/utils/imageUpload.test.ts
git commit -m "test: add unit tests for image validation and Mumble encoding"
```

---

### Task 10: Manual testing and cleanup

- [ ] **Step 1: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run client and test paste flow**

Run: `dotnet run --project src/Brmble.Client`

Test:
1. Copy an image to clipboard, paste in chat input — preview strip should appear
2. Press Escape — preview should be removed
3. Paste image again, hit Enter — message should appear optimistically in chat
4. Try pasting a non-image file — should be ignored
5. Try a file > 5MB — should show validation error that auto-dismisses after 3s

- [ ] **Step 3: Test drag-and-drop flow**

1. Drag an image file over the input area — border highlight should appear
2. Drop the image — preview strip should appear
3. Hit Enter — image should send

- [ ] **Step 4: Test error state**

1. Disconnect from Matrix (or test with invalid credentials)
2. Send an image — should show error overlay on the message
3. Click Dismiss — message should be removed

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "fix: cleanup from manual testing"
```
