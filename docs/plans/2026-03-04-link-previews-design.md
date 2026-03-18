# Link Previews Design

**Issue:** #193
**Date:** 2026-03-04
**Approach:** Matrix server-side previews via `getUrlPreview`

## Summary

Add inline link preview cards to chat messages using Matrix's built-in URL preview infrastructure. The homeserver (Continuwuity) fetches OpenGraph metadata for URLs; the client renders a card below the message text.

## Decisions

- **Data source:** Matrix `getUrlPreview` endpoint (Approach A — no custom backend)
- **Placement:** Below message text, same position as image attachments
- **Limit:** First URL per message only
- **Settings toggle:** None — always on
- **Failure mode:** Silent — render nothing on error

## URL Detection

Extract the first HTTP(S) URL from message text at render time using regex:

```
/https?:\/\/[^\s<>"')\]]+/i
```

Skip `mxc://` URLs (Matrix media, already handled as images), data URIs, and bare domains without protocol. No changes to `ChatMessage` type — extraction happens in `MessageBubble` at render.

## Preview Data Fetching

New `useLinkPreview(url, matrixClient)` hook:

1. Calls `matrixClient.getUrlPreview(url, Date.now())`
2. Returns `{ preview, loading, error }`
3. Preview contains: `og:title`, `og:description`, `og:image` (converted from `mxc://` to HTTP via `mxcUrlToHttp`)
4. Module-level `Map<string, PreviewData>` cache — survives re-renders, clears on page refresh
5. Fails silently — no data means no card rendered

## LinkPreview Component

Card layout:

```
┌──────────────────────────────────┐
│ ┌─────────┐                      │
│ │  thumb  │  Title (og:title)    │
│ │  image  │  Description...      │
│ │ 80x80   │  example.com         │
│ └─────────┘                      │
└──────────────────────────────────┘
```

- Max width: 400px (matches ImageAttachment)
- Thumbnail: 80x80px, `object-fit: cover`
- Title, description (truncated 2-3 lines), domain name
- Clickable — opens URL in new tab
- Loading: skeleton shimmer (like ImageAttachment)
- Error/no data: render nothing
- Styling via CSS tokens: `--bg-elevated`, `--border-subtle`, `--radius-md`, etc.

## Data Flow

```
Message received (useMatrixClient)
  → stored as ChatMessage in useChatStore
  → MessageBubble renders
    → URL_REGEX extracts first URL from content
    → <LinkPreview url={firstUrl} /> renders below text
      → useLinkPreview calls matrixClient.getUrlPreview()
      → success: render card
      → failure: render nothing
```

- No previews for system messages or image-only messages
- Matrix client passed as prop to LinkPreview

## Files

**New:**
- `src/Brmble.Web/src/components/ChatPanel/LinkPreview.tsx`
- `src/Brmble.Web/src/components/ChatPanel/LinkPreview.css`
- `src/Brmble.Web/src/hooks/useLinkPreview.ts`

**Modified:**
- `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` — URL extraction + render LinkPreview

## Prerequisites

- Verify Continuwuity supports `getUrlPreview` (v0.4.6, likely enabled by default — no master toggle exists, allow/deny lists default to permissive)
