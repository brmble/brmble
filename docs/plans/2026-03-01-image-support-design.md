# Image/GIF Support in Chat — Design Document

**Issue:** #194
**Date:** 2026-03-01
**Scope:** Receive and render images/GIFs from both Matrix and Mumble (no upload/sending)

## Overview

Add inline image and GIF rendering to chat messages, with receive-only compatibility between Matrix (`m.image` events) and Mumble (base64 HTML `<img>` tags). The server bridge converts Mumble base64 images into proper Matrix `m.image` events. Sending/uploading images from the Brmble client is deferred to a follow-up iteration.

## Approach

Extend `ChatMessage` with a structured `media` field rather than rendering raw HTML. This gives clean separation of data and presentation, makes thumbnails/lightbox straightforward, and sets up well for upload/sending later.

## Type Changes

New `MediaAttachment` interface added to `types/index.ts`:

```typescript
interface MediaAttachment {
  type: 'image' | 'gif';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimetype?: string;
  size?: number; // bytes
}
```

`ChatMessage` gets an optional `media?: MediaAttachment[]` field.

## Frontend — Message Rendering

### MessageBubble.tsx
- Check for `media` array on the message
- Render each attachment as an `ImageAttachment` component below text content

### New: ImageAttachment.tsx
- Renders `thumbnailUrl` if available, falls back to `url`
- Inline thumbnail: max 400px wide, aspect ratio preserved
- Animated GIFs play inline at thumbnail size
- Loading state (placeholder while image loads)
- Error state (broken image fallback)
- Click opens lightbox with full-size image

### New: ImageLightbox.tsx
- Full-screen overlay with the original image
- Click outside or Escape to close
- Simple — no zoom/pan

## Matrix Path — Receiving m.image Events

### useMatrixClient.ts
- In `onTimeline`, check `msgtype` on the event content
- For `m.image` events, extract:
  - `url` (mxc://) -> convert via `matrixClient.mxcUrlToHttp()`
  - `info.thumbnail_url` -> same conversion
  - `info.w`, `info.h`, `info.mimetype`, `info.size`
- Populate `media` field on `ChatMessage`
- Set `content` to event `body` (usually filename) or empty string
- Use `mxcUrlToHttp(url, 400, 400, 'scale')` for thumbnail, full URL for lightbox

## Mumble Path — Parsing Base64 Images

### New: utils/parseMessageMedia.ts
- Regex to find `<img src="data:(image/[^;]+);base64,([^"]+)"` patterns
- Returns `{ text: string, media: MediaAttachment[] }`
- Validates mimetype is an image type (png, jpeg, gif, webp)
- Rejects images over 5 MB (decoded size)

### App.tsx onVoiceMessage handler
- Before adding message to store, run through `parseMessageMedia()`
- Strip `<img>` tags from text content
- Pass both `content` and `media` to the chat store

## Server Bridge — Mumble Base64 to Matrix m.image

### MatrixService.cs RelayMessage
- Before `StripHtml`, check for `<img src="data:image/...;base64,...">` tags
- For each image found:
  1. Extract mimetype and base64 data
  2. Decode to byte array
  3. Reject if over 5 MB
  4. Upload to Matrix media repo via `POST /_matrix/media/v3/upload` (returns mxc:// URI)
  5. Send as `m.image` event
- Remaining text still sent as `m.text` (HTML stripped)
- A message with both text and image becomes two Matrix events

### MatrixAppService.cs — New methods
- `UploadMedia(byte[] data, string mimetype)` -> returns mxc:// URI
- `SendImageMessage(string roomId, string displayName, string mxcUrl, string mimetype, int size)` -> sends m.image event

## Chat Store Changes

### useChatStore.ts
- `addMessage` gets an optional `media` parameter
- Media serializes fine with JSON for localStorage (strings and numbers only)

## File Change Summary

| Area | Files Changed | New Files |
|------|--------------|-----------|
| Types | `types/index.ts` | — |
| Chat store | `useChatStore.ts` | — |
| Matrix client | `useMatrixClient.ts` | — |
| Mumble parsing | `App.tsx` | `utils/parseMessageMedia.ts` |
| Message rendering | `MessageBubble.tsx` | `ImageAttachment.tsx`, `ImageLightbox.tsx` |
| Server bridge | `MatrixService.cs`, `MatrixAppService.cs` | — |

## Constraints

- **5 MB max** image size (decoded)
- **Thumbnails** max 400px wide inline, click to expand
- **No upload/sending** in this iteration
- **No HTML sanitization** changes (handled separately)
