# Image/GIF Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render inline images and GIFs from both Matrix (`m.image` events) and Mumble (base64 HTML `<img>` tags), and convert Mumble base64 images to Matrix `m.image` events on the server bridge.

**Architecture:** Extend `ChatMessage` with a structured `media` field containing `MediaAttachment[]`. Frontend components render thumbnails with click-to-expand lightbox. The Matrix client extracts media from `m.image` events, the Mumble path parses base64 `<img>` tags, and the server bridge uploads decoded images to the Matrix media repo.

**Tech Stack:** React + TypeScript (frontend), Vitest (frontend tests), C# + MSTest + Moq (server tests), Matrix media API

---

### Task 1: Add MediaAttachment type and extend ChatMessage

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`

**Step 1: Add MediaAttachment interface and extend ChatMessage**

In `src/Brmble.Web/src/types/index.ts`, add above the `ChatMessage` interface:

```typescript
export interface MediaAttachment {
  type: 'image' | 'gif';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimetype?: string;
  size?: number;
}
```

Then add `media?: MediaAttachment[]` to the `ChatMessage` interface:

```typescript
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  content: string;
  timestamp: Date;
  type?: 'system';
  html?: boolean;
  media?: MediaAttachment[];
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add MediaAttachment type to ChatMessage"
```

---

### Task 2: Update useChatStore to accept media

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Update addMessage in useChatStore hook**

Change the `addMessage` callback signature (line 30) from:

```typescript
const addMessage = useCallback((sender: string, content: string, type?: 'system', html?: boolean) => {
```

to:

```typescript
const addMessage = useCallback((sender: string, content: string, type?: 'system', html?: boolean, media?: MediaAttachment[]) => {
```

Add the import at the top:

```typescript
import type { ChatMessage, MediaAttachment } from '../types';
```

And add `media` to the `newMessage` object (after the `html` spread):

```typescript
...(media && media.length > 0 && { media }),
```

**Step 2: Update addMessageToStore function**

Same change to the standalone `addMessageToStore` function (line 60). Add `media?: MediaAttachment[]` parameter and include it in the `newMessage` object:

```typescript
export function addMessageToStore(storeKey: string, sender: string, content: string, type?: 'system', html?: boolean, media?: MediaAttachment[]) {
```

```typescript
...(media && media.length > 0 && { media }),
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useChatStore.ts
git commit -m "feat: add media parameter to chat store functions"
```

---

### Task 3: Create parseMessageMedia utility with tests

**Files:**
- Create: `src/Brmble.Web/src/utils/parseMessageMedia.ts`
- Create: `src/Brmble.Web/src/utils/parseMessageMedia.test.ts`

**Step 1: Write the failing tests**

Create `src/Brmble.Web/src/utils/parseMessageMedia.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMessageMedia } from './parseMessageMedia';

describe('parseMessageMedia', () => {
  it('returns original text and empty media for plain text', () => {
    const result = parseMessageMedia('hello world');
    expect(result.text).toBe('hello world');
    expect(result.media).toHaveLength(0);
  });

  it('extracts a single base64 PNG image', () => {
    const b64 = btoa('fake-png-data');
    const html = `<img src="data:image/png;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.text).toBe('');
    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe('image');
    expect(result.media[0].mimetype).toBe('image/png');
    expect(result.media[0].url).toBe(`data:image/png;base64,${b64}`);
  });

  it('extracts a GIF and sets type to gif', () => {
    const b64 = btoa('fake-gif-data');
    const html = `<img src="data:image/gif;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe('gif');
    expect(result.media[0].mimetype).toBe('image/gif');
  });

  it('preserves surrounding text', () => {
    const b64 = btoa('img');
    const html = `Check this out: <img src="data:image/jpeg;base64,${b64}" /> pretty cool`;
    const result = parseMessageMedia(html);
    expect(result.text).toBe('Check this out:  pretty cool');
    expect(result.media).toHaveLength(1);
  });

  it('extracts multiple images', () => {
    const b64a = btoa('img-a');
    const b64b = btoa('img-b');
    const html = `<img src="data:image/png;base64,${b64a}" /><img src="data:image/jpeg;base64,${b64b}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(2);
  });

  it('rejects images over 5 MB', () => {
    // Create a base64 string that decodes to > 5 MB
    // base64 encodes 3 bytes per 4 chars, so 5*1024*1024 bytes = ~7_000_000 base64 chars
    const bigB64 = 'A'.repeat(7_000_000);
    const html = `<img src="data:image/png;base64,${bigB64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('rejects non-image mimetypes', () => {
    const b64 = btoa('script');
    const html = `<img src="data:text/html;base64,${b64}" />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(0);
  });

  it('handles img tags with single quotes', () => {
    const b64 = btoa('img');
    const html = `<img src='data:image/png;base64,${b64}' />`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
  });

  it('handles img tags without self-closing slash', () => {
    const b64 = btoa('img');
    const html = `<img src="data:image/png;base64,${b64}">`;
    const result = parseMessageMedia(html);
    expect(result.media).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npx vitest run src/utils/parseMessageMedia.test.ts)`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/Brmble.Web/src/utils/parseMessageMedia.ts`:

```typescript
import type { MediaAttachment } from '../types';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMETYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMG_REGEX = /<img\s+[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*\/?>/gi;

export interface ParsedMessage {
  text: string;
  media: MediaAttachment[];
}

export function parseMessageMedia(message: string): ParsedMessage {
  const media: MediaAttachment[] = [];
  let text = message;

  // Reset regex lastIndex for global regex reuse
  IMG_REGEX.lastIndex = 0;

  let match;
  while ((match = IMG_REGEX.exec(message)) !== null) {
    const [fullMatch, mimetype, b64Data] = match;

    if (!ALLOWED_MIMETYPES.includes(mimetype)) continue;

    // Estimate decoded size: base64 encodes 3 bytes per 4 chars
    const estimatedSize = Math.floor((b64Data.length * 3) / 4);
    if (estimatedSize > MAX_SIZE_BYTES) continue;

    media.push({
      type: mimetype === 'image/gif' ? 'gif' : 'image',
      url: `data:${mimetype};base64,${b64Data}`,
      mimetype,
      size: estimatedSize,
    });

    text = text.replace(fullMatch, '');
  }

  return { text: text.trim(), media };
}
```

**Step 4: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npx vitest run src/utils/parseMessageMedia.test.ts)`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/utils/parseMessageMedia.ts src/Brmble.Web/src/utils/parseMessageMedia.test.ts
git commit -m "feat: add parseMessageMedia utility for Mumble base64 images"
```

---

### Task 4: Create ImageAttachment component

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/ImageAttachment.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/ImageAttachment.css`

**Step 1: Create the component**

Create `src/Brmble.Web/src/components/ChatPanel/ImageAttachment.tsx`:

```typescript
import { useState } from 'react';
import type { MediaAttachment } from '../../types';
import './ImageAttachment.css';

interface ImageAttachmentProps {
  attachment: MediaAttachment;
  onOpenLightbox: (url: string) => void;
}

export function ImageAttachment({ attachment, onOpenLightbox }: ImageAttachmentProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const src = attachment.thumbnailUrl ?? attachment.url;

  if (error) {
    return (
      <div className="image-attachment image-attachment--error">
        <span>Failed to load image</span>
      </div>
    );
  }

  return (
    <div className="image-attachment" onClick={() => onOpenLightbox(attachment.url)}>
      {!loaded && <div className="image-attachment__placeholder" />}
      <img
        src={src}
        alt=""
        className={`image-attachment__img ${loaded ? '' : 'image-attachment__img--loading'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
}
```

**Step 2: Create the CSS**

Create `src/Brmble.Web/src/components/ChatPanel/ImageAttachment.css`:

```css
.image-attachment {
  max-width: 400px;
  margin-top: 0.5rem;
  cursor: pointer;
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}

.image-attachment:hover {
  opacity: 0.9;
}

.image-attachment__img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}

.image-attachment__img--loading {
  position: absolute;
  opacity: 0;
}

.image-attachment__placeholder {
  width: 200px;
  height: 150px;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

.image-attachment--error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 100px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 0.8125rem;
  cursor: default;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ImageAttachment.tsx src/Brmble.Web/src/components/ChatPanel/ImageAttachment.css
git commit -m "feat: add ImageAttachment component"
```

---

### Task 5: Create ImageLightbox component

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/ImageLightbox.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/ImageLightbox.css`

**Step 1: Create the component**

Create `src/Brmble.Web/src/components/ChatPanel/ImageLightbox.tsx`:

```typescript
import { useEffect } from 'react';
import './ImageLightbox.css';

interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-lightbox" onClick={onClose}>
      <img
        src={url}
        alt=""
        className="image-lightbox__img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
```

**Step 2: Create the CSS**

Create `src/Brmble.Web/src/components/ChatPanel/ImageLightbox.css`:

```css
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.image-lightbox__img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-md);
  cursor: default;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ImageLightbox.tsx src/Brmble.Web/src/components/ChatPanel/ImageLightbox.css
git commit -m "feat: add ImageLightbox component"
```

---

### Task 6: Integrate media rendering into MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`

**Step 1: Update MessageBubble to render media**

In `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`, add media support:

```typescript
import { useState } from 'react';
import type { MediaAttachment } from '../../types';
import { ImageAttachment } from './ImageAttachment';
import { ImageLightbox } from './ImageLightbox';
import './MessageBubble.css';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
  isSystem?: boolean;
  html?: boolean;
  media?: MediaAttachment[];
}

export function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html, media }: MessageBubbleProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const classes = ['message-bubble'];
  if (isOwnMessage) classes.push('own');
  if (isSystem) classes.push('message-bubble--system');

  return (
    <div className={classes.join(' ')}>
      <div className="message-avatar">
        <span className="avatar-letter">{getAvatarLetter(sender)}</span>
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-sender">{sender}</span>
          <span className="message-time">{formatTime(timestamp)}</span>
        </div>
        {content && (
          html ? (
            <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <p className="message-text">{content}</p>
          )
        )}
        {media && media.length > 0 && (
          <div className="message-media">
            {media.map((attachment, i) => (
              <ImageAttachment
                key={i}
                attachment={attachment}
                onOpenLightbox={setLightboxUrl}
              />
            ))}
          </div>
        )}
      </div>
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}
```

**Step 2: Pass media from ChatPanel to MessageBubble**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`, add the `media` prop to the `MessageBubble` call (line 80-88):

```typescript
<MessageBubble
  key={message.id}
  sender={message.sender}
  content={message.content}
  timestamp={message.timestamp}
  isOwnMessage={!message.type && message.sender === currentUsername}
  isSystem={message.type === 'system'}
  html={message.html}
  media={message.media}
/>
```

**Step 3: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc -b --noEmit)`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat: integrate media rendering into MessageBubble"
```

---

### Task 7: Wire Mumble base64 images through App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Import parseMessageMedia**

At the top of `src/Brmble.Web/src/App.tsx`, add:

```typescript
import { parseMessageMedia } from './utils/parseMessageMedia';
```

**Step 2: Update onVoiceMessage handler**

In the `onVoiceMessage` handler (around line 365-416), before passing messages to the store, parse for media. The key changes are in the places that call `addMessageRef.current()` and `addMessageToStore()`.

Replace the channel message section (lines 391-396):

```typescript
if (!matrixActive) {
  const storeKey = `channel-${channelId}`;
  const { text, media } = parseMessageMedia(d.message);
  if (currentChannelIdRef.current === channelId) {
    addMessageRef.current(senderName, text, undefined, undefined, media.length > 0 ? media : undefined);
  } else {
    addMessageToStore(storeKey, senderName, text, undefined, undefined, media.length > 0 ? media : undefined);
  }
}
```

Replace the DM message section (lines 408-411):

```typescript
const { text: dmText, media: dmMedia } = parseMessageMedia(d.message);
if (isViewingThisDM) {
  addDMMessageRef.current(senderName, dmText, undefined, undefined, dmMedia.length > 0 ? dmMedia : undefined);
} else {
  addMessageToStore(dmStoreKey, senderName, dmText, undefined, undefined, dmMedia.length > 0 ? dmMedia : undefined);
}
```

**Step 3: Verify the frontend builds**

Run: `(cd src/Brmble.Web && npx tsc -b --noEmit)`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire Mumble base64 image parsing into message handler"
```

---

### Task 8: Handle m.image events in useMatrixClient

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

**Step 1: Update the onTimeline handler for channel messages**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, update the `onTimeline` handler. After the `if (channelId)` block (line 76), replace the content extraction (lines 81-88) with:

```typescript
if (channelId) {
  const senderId = event.getSender() ?? 'Unknown';
  const senderMember = room?.getMember(senderId);
  const displayName = senderMember?.name || senderMember?.rawDisplayName || senderId;

  const content = event.getContent() as {
    body?: string;
    msgtype?: string;
    url?: string;
    info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
  };

  let media: MediaAttachment[] | undefined;
  if (content.msgtype === 'm.image' && content.url) {
    const cl = clientRef.current;
    const fullUrl = cl?.mxcUrlToHttp(content.url) ?? content.url;
    const thumbUrl = content.info?.thumbnail_url
      ? (cl?.mxcUrlToHttp(content.info.thumbnail_url, 400, 400, 'scale') ?? undefined)
      : (cl?.mxcUrlToHttp(content.url, 400, 400, 'scale') ?? undefined);

    media = [{
      type: content.info?.mimetype === 'image/gif' ? 'gif' : 'image',
      url: fullUrl,
      thumbnailUrl: thumbUrl,
      width: content.info?.w,
      height: content.info?.h,
      mimetype: content.info?.mimetype,
      size: content.info?.size,
    }];
  }

  const message: ChatMessage = {
    id: event.getId() ?? crypto.randomUUID(),
    channelId,
    sender: displayName,
    content: content.body ?? '',
    timestamp: new Date(event.getTs()),
    ...(media && { media }),
  };

  setMessages(prev => {
    const existing = prev.get(channelId) ?? [];
    const updated = insertMessage(existing, message);
    if (updated === existing) return prev;
    return new Map(prev).set(channelId, updated);
  });
  return;
}
```

**Step 2: Update the DM message handling the same way**

Apply the same pattern to the DM section (lines 100-121):

```typescript
const dmSenderId = event.getSender() ?? 'Unknown';
const dmSenderMember = room?.getMember(dmSenderId);
const dmDisplayName = dmSenderMember?.name || dmSenderMember?.rawDisplayName || dmSenderId;

const dmContent = event.getContent() as {
  body?: string;
  msgtype?: string;
  url?: string;
  info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
};

let dmMedia: MediaAttachment[] | undefined;
if (dmContent.msgtype === 'm.image' && dmContent.url) {
  const cl = clientRef.current;
  const fullUrl = cl?.mxcUrlToHttp(dmContent.url) ?? dmContent.url;
  const thumbUrl = dmContent.info?.thumbnail_url
    ? (cl?.mxcUrlToHttp(dmContent.info.thumbnail_url, 400, 400, 'scale') ?? undefined)
    : (cl?.mxcUrlToHttp(dmContent.url, 400, 400, 'scale') ?? undefined);

  dmMedia = [{
    type: dmContent.info?.mimetype === 'image/gif' ? 'gif' : 'image',
    url: fullUrl,
    thumbnailUrl: thumbUrl,
    width: dmContent.info?.w,
    height: dmContent.info?.h,
    mimetype: dmContent.info?.mimetype,
    size: dmContent.info?.size,
  }];
}

const dmMessage: ChatMessage = {
  id: event.getId() ?? crypto.randomUUID(),
  channelId: dmUserId,
  sender: dmDisplayName,
  content: dmContent.body ?? '',
  timestamp: new Date(event.getTs()),
  ...(dmMedia && { media: dmMedia }),
};

setDmMessages(prev => {
  const existing = prev.get(dmUserId) ?? [];
  const updated = insertMessage(existing, dmMessage);
  if (updated === existing) return prev;
  return new Map(prev).set(dmUserId, updated);
});
```

**Step 3: Add the import**

Add at the top of the file:

```typescript
import type { ChatMessage, MediaAttachment } from '../types';
```

(Replace the existing `import type { ChatMessage } from '../types';`)

**Step 4: Verify build**

Run: `(cd src/Brmble.Web && npx tsc -b --noEmit)`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts
git commit -m "feat: handle m.image events in Matrix client"
```

---

### Task 9: Add UploadMedia and SendImageMessage to server bridge

**Files:**
- Modify: `src/Brmble.Server/Matrix/IMatrixAppService` (in `MatrixAppService.cs`)
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs`

**Step 1: Write failing tests**

Add to `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`:

```csharp
[TestMethod]
public async Task UploadMedia_PutsToMediaEndpointWithContentType()
{
    SetupHttpResponse(HttpStatusCode.OK,
        """{"content_uri":"mxc://server/abc123"}""");

    var result = await _svc.UploadMedia(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, "image/png", "image.png");

    Assert.AreEqual("mxc://server/abc123", result);
    var req = _capturedRequests.Single();
    Assert.AreEqual(HttpMethod.Post, req.Method);
    StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/media/v3/upload");
    Assert.AreEqual("image/png", req.Content!.Headers.ContentType!.MediaType);
}

[TestMethod]
public async Task SendImageMessage_PutsImageEventToRoom()
{
    SetupHttpResponse(HttpStatusCode.OK);

    await _svc.SendImageMessage("!room:server", "Alice", "mxc://server/abc123", "image.png", "image/png", 1234);

    var req = _capturedRequests.Single();
    Assert.AreEqual(HttpMethod.Put, req.Method);
    StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/client/v3/rooms/!room:server/send/m.room.message/");
    var body = await req.Content!.ReadAsStringAsync();
    StringAssert.Contains(body, "m.image");
    StringAssert.Contains(body, "mxc://server/abc123");
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MatrixAppServiceTests"`
Expected: FAIL — methods don't exist

**Step 3: Add methods to IMatrixAppService interface**

In `src/Brmble.Server/Matrix/MatrixAppService.cs`, add to the `IMatrixAppService` interface:

```csharp
Task<string> UploadMedia(byte[] data, string contentType, string fileName);
Task SendImageMessage(string roomId, string displayName, string mxcUrl, string fileName, string mimetype, int size);
```

**Step 4: Implement the methods in MatrixAppService**

```csharp
public async Task<string> UploadMedia(byte[] data, string contentType, string fileName)
{
    var url = $"{_homeserverUrl}/_matrix/media/v3/upload?filename={Uri.EscapeDataString(fileName)}";
    var client = _httpClientFactory.CreateClient();
    var urlWithUser = $"{url}&user_id={Uri.EscapeDataString(_botUserId)}";
    var request = new HttpRequestMessage(HttpMethod.Post, urlWithUser)
    {
        Content = new ByteArrayContent(data)
    };
    request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _appServiceToken);
    _logger.LogDebug("Matrix upload: POST {Url} ({Size} bytes)", urlWithUser, data.Length);
    var response = await client.SendAsync(request);
    if (!response.IsSuccessStatusCode)
    {
        var body = await response.Content.ReadAsStringAsync();
        _logger.LogError("Matrix upload failed: {Status} {Body}", (int)response.StatusCode, body);
    }
    response.EnsureSuccessStatusCode();
    var responseBody = await response.Content.ReadAsStringAsync();
    var json = JsonSerializer.Deserialize<JsonElement>(responseBody);
    return json.GetProperty("content_uri").GetString()
        ?? throw new InvalidOperationException("Matrix did not return a content_uri");
}

public async Task SendImageMessage(string roomId, string displayName, string mxcUrl, string fileName, string mimetype, int size)
{
    var txnId = Guid.NewGuid().ToString("N");
    var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}";
    var body = JsonSerializer.Serialize(new
    {
        msgtype = "m.image",
        body = $"[{displayName}]: {fileName}",
        url = mxcUrl,
        info = new { mimetype, size }
    });
    await SendRequest(HttpMethod.Put, url, body);
}
```

**Step 5: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MatrixAppServiceTests"`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/Brmble.Server/Matrix/MatrixAppService.cs tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs
git commit -m "feat: add UploadMedia and SendImageMessage to MatrixAppService"
```

---

### Task 10: Update MatrixService.RelayMessage to handle base64 images

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixService.cs`

**Step 1: Write failing tests**

Add to `tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs`:

```csharp
[TestMethod]
public async Task RelayMessage_Base64Image_UploadsAndSendsImageEvent()
{
    _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
    await _channelRepo.InsertAsync(1, "!room:server");

    _appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"))
        .ReturnsAsync("mxc://server/uploaded123");

    var b64 = Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47 });
    var msg = $"<img src=\"data:image/png;base64,{b64}\" />";

    await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

    _appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"), Times.Once);
    _appService.Verify(a => a.SendImageMessage("!room:server", "Bob", "mxc://server/uploaded123", "image.png", "image/png", 4), Times.Once);
    _appService.Verify(a => a.SendMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
}

[TestMethod]
public async Task RelayMessage_Base64ImageWithText_SendsBothImageAndText()
{
    _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
    await _channelRepo.InsertAsync(1, "!room:server");

    _appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "image.png"))
        .ReturnsAsync("mxc://server/uploaded123");

    var b64 = Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47 });
    var msg = $"Check this out: <img src=\"data:image/png;base64,{b64}\" />";

    await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

    _appService.Verify(a => a.SendImageMessage("!room:server", "Bob", "mxc://server/uploaded123", "image.png", "image/png", 4), Times.Once);
    _appService.Verify(a => a.SendMessage("!room:server", "Bob", "Check this out:"), Times.Once);
}

[TestMethod]
public async Task RelayMessage_Base64ImageOver5MB_SkipsImageSendsText()
{
    _sessions.Setup(s => s.IsBrmbleClient("og-hash")).Returns(false);
    await _channelRepo.InsertAsync(1, "!room:server");

    // Create base64 > 5 MB
    var bigData = new byte[6 * 1024 * 1024];
    var bigB64 = Convert.ToBase64String(bigData);
    var msg = $"<img src=\"data:image/png;base64,{bigB64}\" />";

    await _svc.RelayMessage(new MumbleUser("Bob", "og-hash", 1), msg, 1);

    _appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    _appService.Verify(a => a.SendImageMessage(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()), Times.Never);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MatrixServiceTests"`
Expected: FAIL

**Step 3: Implement image extraction in RelayMessage**

Replace the `RelayMessage` method in `src/Brmble.Server/Matrix/MatrixService.cs`:

```csharp
private static readonly Regex ImgRegex = new(
    @"<img\s+[^>]*src=[""']data:(image/[^;]+);base64,([^""']+)[""'][^>]*/?>",
    RegexOptions.IgnoreCase | RegexOptions.Compiled);

private static readonly HashSet<string> AllowedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
{
    "image/png", "image/jpeg", "image/gif", "image/webp"
};

private const int MaxImageSizeBytes = 5 * 1024 * 1024;

private static readonly Dictionary<string, string> MimeToExtension = new(StringComparer.OrdinalIgnoreCase)
{
    ["image/png"] = "png",
    ["image/jpeg"] = "jpg",
    ["image/gif"] = "gif",
    ["image/webp"] = "webp",
};

public async Task RelayMessage(MumbleUser sender, string text, int channelId)
{
    if (_activeSessions.IsBrmbleClient(sender.CertHash) || _activeSessions.IsBrmbleClientByName(sender.Name))
    {
        _logger.LogDebug("Skipping relay for Brmble client {User}", sender.Name);
        return;
    }

    var roomId = await _channelRepository.GetRoomIdAsync(channelId);
    if (roomId is null)
    {
        _logger.LogWarning("No Matrix room mapped for Mumble channel {ChannelId} — message from {User} dropped", channelId, sender.Name);
        return;
    }

    // Extract and upload base64 images
    var remaining = text;
    var matches = ImgRegex.Matches(text);
    foreach (Match match in matches)
    {
        var mimetype = match.Groups[1].Value;
        var b64Data = match.Groups[2].Value;

        if (!AllowedMimeTypes.Contains(mimetype)) continue;

        byte[] imageData;
        try { imageData = Convert.FromBase64String(b64Data); }
        catch { continue; }

        if (imageData.Length > MaxImageSizeBytes)
        {
            _logger.LogWarning("Skipping image from {User}: {Size} bytes exceeds limit", sender.Name, imageData.Length);
            continue;
        }

        var ext = MimeToExtension.GetValueOrDefault(mimetype, "png");
        var fileName = $"image.{ext}";

        try
        {
            var mxcUrl = await _appService.UploadMedia(imageData, mimetype, fileName);
            await _appService.SendImageMessage(roomId, sender.Name, mxcUrl, fileName, mimetype, imageData.Length);
            remaining = remaining.Replace(match.Value, "");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upload/send image from {User}", sender.Name);
        }
    }

    // Send remaining text if any
    var plainText = StripHtml(remaining);
    if (!string.IsNullOrWhiteSpace(plainText))
    {
        _logger.LogInformation("Relaying message from {User} in channel {ChannelId} to {RoomId}", sender.Name, channelId, roomId);
        await _appService.SendMessage(roomId, sender.Name, plainText);
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MatrixServiceTests"`
Expected: All PASS

**Step 5: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: All PASS (existing tests should still pass since the text-only path is preserved)

**Step 6: Commit**

```bash
git add src/Brmble.Server/Matrix/MatrixService.cs tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs
git commit -m "feat: handle base64 images in Mumble-to-Matrix relay"
```

---

### Task 11: Run full build and all tests

**Step 1: Build everything**

Run: `dotnet build`
Expected: Build succeeded

**Step 2: Run all .NET tests**

Run: `dotnet test`
Expected: All tests pass

**Step 3: Run frontend tests**

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests pass

**Step 4: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded

---

### Task Dependencies

```
Task 1 (types) ──┬── Task 2 (store) ──── Task 7 (App.tsx wiring)
                  │
                  ├── Task 3 (parser + tests) ── Task 7
                  │
                  ├── Task 4 (ImageAttachment) ── Task 6 (MessageBubble integration)
                  │
                  ├── Task 5 (ImageLightbox) ──── Task 6
                  │
                  └── Task 8 (Matrix client)

Task 9 (AppService methods + tests) ── Task 10 (MatrixService relay + tests)

Task 11 (full build + test) depends on all above
```

Tasks 1-8 are frontend. Tasks 9-10 are server. They can be done in parallel tracks.
Frontend track: 1 → (2, 3, 4, 5 in parallel) → 6 → 7 → 8
Server track: 9 → 10
Final: 11
