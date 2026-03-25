# Image Upload/Sending Support in Chat

**Issue:** #200
**Date:** 2026-03-25
**Status:** Approved

## Overview

Add the ability to send images from the Brmble client via paste and drag-and-drop. Images are sent simultaneously to both Matrix (as `m.image` events) and Mumble (as base64 HTML img tags). This builds on the existing receive-only image support merged in #194.

## Scope

- Clipboard paste-to-send
- Drag-and-drop onto chat input
- Inline preview before sending
- Optimistic send with error/retry
- File validation: PNG, JPEG, GIF, WebP only, 5MB max
- Single image per message (v1)

### Out of scope

- Upload button in chat input
- Video support
- Multi-image messages
- Server-side upload proxy
- Image upload in DMs (channel chat only for v1; DM path via `useDMStore` can be added as follow-up)

## Architecture

### Approach: Frontend-only

All image handling happens in React. No server changes required.

- Matrix path: `matrix-js-sdk` `uploadContent()` uploads the file directly to the Matrix media repo, returns an mxc:// URL, then `sendMessage()` sends an `m.image` event.
- Mumble path: File is read as base64 via `FileReader`, wrapped in an HTML `<img>` tag, and sent through the WebView2 bridge via `voice.sendMessage`.

This was chosen over server-mediated upload (Approach B) and hybrid (Approach C) because the Matrix SDK already handles uploads, the Mumble base64 path is straightforward, and no server changes are needed. The 5MB limit keeps base64 encoding manageable (~6.7MB encoded, well within WebView2 message limits).

## Component Architecture

### MessageInput.tsx (modified)

Gains paste and drop event handlers and a new `pendingImage` state:

1. `onPaste` handler checks `clipboardData.files` and `clipboardData.items` for image types
2. `onDragOver`/`onDrop` handlers accept image files with visual drag-over feedback
3. Valid images are staged as a `pendingImage: File` state
4. Preview strip renders above the textarea showing thumbnail (64px height), filename, size, and remove button
5. On send (Enter key), calls new `onSendImage(file, text?)` callback

**Prop signature change:** `onSend: (content: string) => void` becomes `onSend: (content: string, image?: File) => void`. This signature change propagates through ChatPanel.tsx (`onSendMessage` prop) up to App.tsx (`handleSendMessage`). The send button is enabled when `message.trim() || pendingImage` (allowing image-only sends).

**Validation reuse:** Import `MAX_SIZE_BYTES` and `ALLOWED_MIMETYPES` from `utils/parseMessageMedia.ts` rather than duplicating constants.

### New: useImageUpload hook

Encapsulates upload logic and state:

- `uploadToMatrix(file: File): Promise<{ mxcUrl: string }>` - uses `matrix-js-sdk` `uploadContent()`
- `encodeForMumble(file: File): Promise<string>` - reads file as base64, wraps in `<img src="data:...;base64,...">` tag
- Exposes upload state: `idle | uploading | success | error`
- Requires the Matrix client instance as input — `useMatrixClient` must be extended to expose `client.uploadContent()` (currently not exposed)

### useMatrixClient.ts (modified)

The hook currently returns `{ messages, sendMessage, client: null, ... }` but does not expose `uploadContent`. Changes needed:

- Expose `uploadContent(file: File): Promise<string>` that wraps `client.uploadContent()` and returns the mxc:// URL
- Alternatively, expose the raw `client` ref so `useImageUpload` can call `uploadContent` directly

### App.tsx / ChatPanel (modified)

Send handler extended:

- Current: `handleSendMessage(content: string)` — has a `!content` early return guard
- New: `handleSendMessage(content: string, image?: File)` — guard updated to `!content && !image` to allow image-only sends
- When image is present, creates optimistic `ChatMessage` with local object URL as media and `pending: true`

## Data Flow

### Paste/Drop to Preview

```
User pastes/drops image
  -> MessageInput validates type + size
  -> Creates Object URL for preview
  -> Shows preview strip (thumbnail + remove button)
  -> User can still type text alongside
```

### Send

```
User hits Enter
  -> MessageInput calls onSendImage(file, text?)
  -> App.tsx creates optimistic ChatMessage:
      { id: temp-uuid, content: text, media: [{ url: objectURL }], pending: true }
  -> Message appears in chat immediately

  -> Parallel:
      Matrix: uploadContent(file) -> mxcUrl -> sendMessage(room, m.image, { url, body, info })
      Mumble: readAsDataURL(file) -> bridge.send('voice.sendMessage', { message: '<img ...>' })

  -> On Matrix sync echo: optimistic message replaced with real one
  -> On error: message.error = true, show retry overlay
```

### Text + Image

When both text and image are present:
- Matrix: send `m.text` event for the text, `m.image` event for the image (separate events, standard Matrix pattern)
- Mumble: concatenate text + img tag in one message

## UI Behavior

### Preview Strip

- Appears between the textarea top and the input container top edge
- Small thumbnail: 64px height, aspect ratio preserved
- Filename + file size label
- X button to remove
- Subtle border/background to distinguish from message area

### Drag-and-drop feedback

- Border highlight on the input wrapper when dragging an image over it
- Only accepts image file types, ignores everything else

### Validation errors

- Wrong file type: inline error below preview strip ("Only PNG, JPEG, GIF, and WebP images are supported")
- Too large: inline error ("Image must be under 5MB")
- Errors auto-dismiss after 3 seconds

### Single image constraint

- Pasting/dropping a second image replaces the first
- Multi-image is a future enhancement

### Keyboard accessibility

- Escape while preview is shown removes the staged image
- Focus stays on the textarea throughout

## Error Handling

### Upload failures

- Network error or Matrix server error: red overlay on the optimistic message with retry icon
- Click retry: re-attempts both Matrix upload and Mumble send
- Click dismiss (X): removes the failed message from chat

### Partial failures

- Matrix succeeds, Mumble fails: message shows in chat (Matrix worked), Mumble error logged. No user-facing error since message landed for Brmble users.
- Matrix fails, Mumble succeeds: show error state, retry only re-attempts Matrix upload.

### Validation (pre-send)

- File type not in allowlist: inline error, image not staged
- File > 5MB: inline error, image not staged
- 0-byte file: silently ignored

### Resource cleanup

- Revoke Object URLs when preview is dismissed, on successful send, or on component unmount
- Prevents memory leaks from repeated paste/drop

### Concurrent sends

- User can send text messages while a previous image is still uploading
- Each optimistic message tracks its own upload state independently

## Testing Strategy

### Unit tests

- `useImageUpload` hook: mock `matrix-js-sdk` `uploadContent()`, verify upload states (idle -> uploading -> success/error), verify base64 encoding for Mumble path
- File validation: each allowed type passes, disallowed types rejected, size limit enforced, 0-byte files ignored

### Component tests

- MessageInput: simulate paste event with image file, verify preview strip appears, verify X removes it, verify Enter triggers `onSendImage`
- MessageInput: simulate drop event, verify same flow
- MessageInput: paste invalid file type, verify error message shown
- MessageBubble: verify error overlay renders when `message.error = true`, verify retry button calls handler

### Integration tests

- Full send flow with mocked Matrix client: paste image -> send -> optimistic message appears -> `uploadContent` called -> `sendMessage` called with `m.image` -> optimistic message replaced on sync echo
- Error flow: mock upload failure -> error overlay -> click retry -> verify re-attempt

### Not in scope for v1

- E2E tests (require running Matrix homeserver)

## Key Files

| File | Change |
|------|--------|
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` | Add paste/drop handlers, preview strip, onSendImage callback |
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.css` | Preview strip styling, drag-over feedback |
| `src/Brmble.Web/src/hooks/useImageUpload.ts` | New hook: upload to Matrix, encode for Mumble |
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Expose uploadContent() for image uploads |
| `src/Brmble.Web/src/utils/parseMessageMedia.ts` | Export existing MAX_SIZE_BYTES and ALLOWED_MIMETYPES constants |
| `src/Brmble.Web/src/App.tsx` | Extend handleSendMessage to accept image File, update !content guard |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` | Wire through onSendImage, manage optimistic messages with error state |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` | Add error overlay with retry/dismiss for failed image sends |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` | Error overlay styling |
| `src/Brmble.Web/src/types/index.ts` | Add `error?: boolean` to ChatMessage, possibly `onRetry` callback |

## Related

- #194 - Receive-only image/GIF support (merged)
- #58 - In-game screenshot capture (future, depends on this)
- `docs/plans/2026-03-01-image-support-design.md` - Original design doc for image receive path
