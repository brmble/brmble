# Link Previews Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline link preview cards to chat messages using Matrix's server-side URL preview API.

**Architecture:** Extract the first URL from message text at render time in MessageBubble. A `useLinkPreview` hook calls `matrixClient.getUrlPreview()` and returns OG metadata. A `LinkPreview` component renders the card below message text. The Matrix client ref is exposed from `useMatrixClient` and threaded through props.

**Tech Stack:** React, TypeScript, matrix-js-sdk (`getUrlPreview`, `mxcUrlToHttp`), CSS tokens (see `docs/UI_GUIDE.md`)

---

### Task 1: Expose Matrix client ref from useMatrixClient

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:279`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

**Step 1: Update the return value to include the client ref**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, change the return statement (line 279) from:

```typescript
return { messages, sendMessage, fetchHistory, dmMessages, dmRoomMap, sendDMMessage, fetchDMHistory };
```

to:

```typescript
return { messages, sendMessage, fetchHistory, dmMessages, dmRoomMap, sendDMMessage, fetchDMHistory, client: clientRef.current };
```

**Step 2: Update test mock to verify client is returned**

Add a test in `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`:

```typescript
it('exposes the Matrix client instance', () => {
  const { result } = renderHook(() => useMatrixClient(creds));
  expect(result.current.client).toBeDefined();
});

it('client is null when credentials are null', () => {
  const { result } = renderHook(() => useMatrixClient(null));
  expect(result.current.client).toBeNull();
});
```

**Step 3: Run tests**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: expose Matrix client instance from useMatrixClient hook"
```

---

### Task 2: Create useLinkPreview hook with tests

**Files:**
- Create: `src/Brmble.Web/src/hooks/useLinkPreview.ts`
- Create: `src/Brmble.Web/src/hooks/useLinkPreview.test.ts`

**Step 1: Write the test file**

Create `src/Brmble.Web/src/hooks/useLinkPreview.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLinkPreview, extractFirstUrl, clearPreviewCache } from './useLinkPreview';

beforeEach(() => {
  clearPreviewCache();
});

describe('extractFirstUrl', () => {
  it('extracts http URL from text', () => {
    expect(extractFirstUrl('check out http://example.com ok')).toBe('http://example.com');
  });

  it('extracts https URL from text', () => {
    expect(extractFirstUrl('see https://github.com/brmble/brmble for info')).toBe('https://github.com/brmble/brmble');
  });

  it('returns null when no URL present', () => {
    expect(extractFirstUrl('just a regular message')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractFirstUrl('')).toBeNull();
  });

  it('extracts only the first URL', () => {
    expect(extractFirstUrl('first https://a.com then https://b.com')).toBe('https://a.com');
  });

  it('ignores mxc:// URLs', () => {
    expect(extractFirstUrl('mxc://server/media123')).toBeNull();
  });

  it('handles URL with path and query', () => {
    expect(extractFirstUrl('link: https://example.com/path?q=1&b=2')).toBe('https://example.com/path?q=1&b=2');
  });

  it('stops at closing paren or bracket', () => {
    expect(extractFirstUrl('(see https://example.com)')).toBe('https://example.com');
  });
});

describe('useLinkPreview', () => {
  it('returns null preview when url is null', () => {
    const { result } = renderHook(() => useLinkPreview(null, null));
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('returns null preview when client is null', () => {
    const { result } = renderHook(() => useLinkPreview('https://example.com', null));
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches preview and returns OG data', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Example',
        'og:description': 'An example page',
        'og:image': 'mxc://server/image123',
      }),
      mxcUrlToHttp: vi.fn((url: string) => url.replace('mxc://', 'https://matrix.example.com/_matrix/media/v3/download/')),
    };

    const { result } = renderHook(() => useLinkPreview('https://example.com', mockClient as any));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.preview).not.toBeNull();
    });

    expect(result.current.preview?.title).toBe('Example');
    expect(result.current.preview?.description).toBe('An example page');
    expect(result.current.preview?.imageUrl).toBe('https://matrix.example.com/_matrix/media/v3/download/server/image123');
    expect(result.current.preview?.url).toBe('https://example.com');
  });

  it('returns null preview on fetch error', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockRejectedValue(new Error('Not found')),
      mxcUrlToHttp: vi.fn(),
    };

    const { result } = renderHook(() => useLinkPreview('https://bad.com', mockClient as any));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.preview).toBeNull();
  });

  it('uses cache on subsequent calls with same URL', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Cached',
      }),
      mxcUrlToHttp: vi.fn(),
    };

    const { result, rerender } = renderHook(
      ({ url }) => useLinkPreview(url, mockClient as any),
      { initialProps: { url: 'https://cached.com' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ url: 'https://cached.com' });

    expect(mockClient.getUrlPreview).toHaveBeenCalledTimes(1);
  });

  it('extracts domain from URL', async () => {
    const mockClient = {
      getUrlPreview: vi.fn().mockResolvedValue({
        'og:title': 'Title',
      }),
      mxcUrlToHttp: vi.fn(),
    };

    const { result } = renderHook(() => useLinkPreview('https://www.example.com/page', mockClient as any));

    await waitFor(() => expect(result.current.preview).not.toBeNull());

    expect(result.current.preview?.domain).toBe('www.example.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useLinkPreview.test.ts)`
Expected: FAIL — module not found

**Step 3: Write the hook implementation**

Create `src/Brmble.Web/src/hooks/useLinkPreview.ts`:

```typescript
import { useState, useEffect } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/i;

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  domain: string;
}

const cache = new Map<string, LinkPreviewData | null>();

export function clearPreviewCache() {
  cache.clear();
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

export function useLinkPreview(url: string | null, client: MatrixClient | null) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url || !client) {
      setPreview(null);
      setLoading(false);
      return;
    }

    if (cache.has(url)) {
      setPreview(cache.get(url) ?? null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    client.getUrlPreview(url, Date.now()).then(
      (data: Record<string, string | number | undefined>) => {
        if (cancelled) return;

        const title = data['og:title'] as string | undefined;
        const description = data['og:description'] as string | undefined;
        const ogImage = data['og:image'] as string | undefined;

        if (!title && !description && !ogImage) {
          cache.set(url, null);
          setPreview(null);
          setLoading(false);
          return;
        }

        let imageUrl: string | undefined;
        if (ogImage) {
          imageUrl = ogImage.startsWith('mxc://')
            ? (client.mxcUrlToHttp(ogImage, 400, 400, 'scale') ?? undefined)
            : ogImage;
        }

        let domain: string;
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = url;
        }

        const result: LinkPreviewData = { url, title, description, imageUrl, domain };
        cache.set(url, result);
        setPreview(result);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        cache.set(url, null);
        setPreview(null);
        setLoading(false);
      }
    );

    return () => { cancelled = true; };
  }, [url, client]);

  return { preview, loading };
}
```

**Step 4: Run tests**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useLinkPreview.test.ts)`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useLinkPreview.ts src/Brmble.Web/src/hooks/useLinkPreview.test.ts
git commit -m "feat: add useLinkPreview hook with URL extraction and caching"
```

---

### Task 3: Create LinkPreview component

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/LinkPreview.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/LinkPreview.css`

Refer to `docs/UI_GUIDE.md` for token system rules. Never hardcode colors, spacing, or border radius.

**Step 1: Create the CSS file**

Create `src/Brmble.Web/src/components/ChatPanel/LinkPreview.css`:

```css
.link-preview {
  display: flex;
  gap: var(--space-sm);
  max-width: 400px;
  margin-top: var(--space-xs);
  padding: var(--space-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition: background var(--transition-fast);
}

.link-preview:hover {
  background: var(--bg-hover);
}

.link-preview__thumb {
  width: 80px;
  height: 80px;
  min-width: 80px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.link-preview__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.link-preview__title {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-preview__description {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-preview__domain {
  margin: 0;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.link-preview__placeholder {
  max-width: 400px;
  height: 48px;
  margin-top: var(--space-xs);
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  animation: pulse 1.5s ease-in-out infinite;
}
```

**Step 2: Create the component**

Create `src/Brmble.Web/src/components/ChatPanel/LinkPreview.tsx`:

```tsx
import type { MatrixClient } from 'matrix-js-sdk';
import { useLinkPreview } from '../../hooks/useLinkPreview';
import './LinkPreview.css';

interface LinkPreviewProps {
  url: string;
  client: MatrixClient | null;
}

export function LinkPreview({ url, client }: LinkPreviewProps) {
  const { preview, loading } = useLinkPreview(url, client);

  if (loading) {
    return <div className="link-preview__placeholder" />;
  }

  if (!preview) {
    return null;
  }

  return (
    <a
      className="link-preview"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {preview.imageUrl && (
        <img
          className="link-preview__thumb"
          src={preview.imageUrl}
          alt=""
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="link-preview__body">
        {preview.title && <p className="link-preview__title">{preview.title}</p>}
        {preview.description && <p className="link-preview__description">{preview.description}</p>}
        <p className="link-preview__domain">{preview.domain}</p>
      </div>
    </a>
  );
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/LinkPreview.tsx src/Brmble.Web/src/components/ChatPanel/LinkPreview.css
git commit -m "feat: add LinkPreview component with thumbnail and OG metadata"
```

---

### Task 4: Integrate LinkPreview into MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add `matrixClient` prop to MessageBubble and render LinkPreview**

In `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`:

Add imports at the top:

```typescript
import type { MatrixClient } from 'matrix-js-sdk';
import { extractFirstUrl } from '../../hooks/useLinkPreview';
import { LinkPreview } from './LinkPreview';
```

Add `matrixClient` to the props interface:

```typescript
interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
  isSystem?: boolean;
  html?: boolean;
  media?: MediaAttachment[];
  matrixClient?: MatrixClient | null;
}
```

Update the function signature:

```typescript
export function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html, media, matrixClient }: MessageBubbleProps) {
```

Add URL extraction after the `classes` array (before the return):

```typescript
const firstUrl = (!isSystem && content) ? extractFirstUrl(content) : null;
```

Add the LinkPreview after the media section and before the closing `</div>` of `message-content` (after line 58, before line 59):

```tsx
{firstUrl && matrixClient && (
  <LinkPreview url={firstUrl} client={matrixClient} />
)}
```

**Step 2: Thread `matrixClient` through ChatPanel**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`:

Add import:

```typescript
import type { MatrixClient } from 'matrix-js-sdk';
```

Add to `ChatPanelProps`:

```typescript
matrixClient?: MatrixClient | null;
```

Update function signature to destructure `matrixClient`.

Pass it to MessageBubble:

```tsx
<MessageBubble
  key={message.id}
  sender={message.sender}
  content={message.content}
  timestamp={message.timestamp}
  isOwnMessage={!message.type && message.sender === currentUsername}
  isSystem={message.type === 'system'}
  html={message.html}
  media={message.media}
  matrixClient={matrixClient}
/>
```

**Step 3: Pass `matrixClient.client` from App.tsx to ChatPanel**

In `src/Brmble.Web/src/App.tsx`, find where `ChatPanel` is rendered and add the `matrixClient` prop. The hook is called on line 152 as `const matrixClient = useMatrixClient(matrixCredentials);`. Pass `matrixClient.client`:

```tsx
<ChatPanel
  ...existing props...
  matrixClient={matrixClient.client}
/>
```

Do this for every `<ChatPanel>` instance (channels and DM).

**Step 4: Run all frontend tests**

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: wire LinkPreview into message rendering pipeline"
```

---

### Task 5: Manual testing and verification

**Step 1: Build and run**

Run: `(cd src/Brmble.Web && npm run build)` to verify no build errors.

**Step 2: Start the app**

Start Vite dev server and Brmble client. Connect to a server. Send a message containing a URL (e.g. `check out https://github.com`). Verify:

- A preview card appears below the message text
- Card shows title, description, and domain
- Card shows thumbnail if available
- Clicking the card opens the URL in a new tab
- Messages without URLs show no preview card
- System messages show no preview card
- The loading skeleton appears briefly while fetching

**Step 3: Run full test suite**

Run: `dotnet test` — verify all .NET tests pass.
Run: `(cd src/Brmble.Web && npx vitest run)` — verify all frontend tests pass.

**Step 4: Commit any fixes if needed**
