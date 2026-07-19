# LiveKit Sidebar Stats Tooltip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow superpowers:test-driven-development rigidly: write the failing test, run it to confirm it fails for the right reason, write minimal code, confirm it passes, then commit.

**Goal:** Enrich the sidebar's LiveKit (Screenshare) service-status dot hover tooltip with an at-a-glance health summary of active screenshare activity. When broadcasting, add a `Broadcasting: <resolution> <fps>fps` line. When watching, add a `Watching N share(s)` line followed by one `<name>: <W>×<H> (<quality>)` line per watched share. Uses only data the client already has — no `getStats()` plumbing, no change to the shared `Tooltip` component, no `UI_GUIDE.md` change.

**Architecture:** A new small, pure string-builder (`buildLiveKitTooltip`) takes plain inputs (name, connection flags, quality, `isSharing`, preformatted `broadcastSummary`, `watchingShares`, `shareQualities`, `remoteVideoEls`) and returns the multi-line tooltip string (existing `\n` convention, same as the voice/server tooltips). `Sidebar.dotTooltip('livekit')` delegates to it. `App.tsx` threads five new optional props into `Sidebar` (four new + reusing the already-present `watchingShares`), and preformats `broadcastSummary` from `screenShareSettings`. Live per-share resolution is read from each remote `<video>` element's `videoWidth`/`videoHeight` at render time. No changes to `useScreenShare`, the `Tooltip` component, or `screenShareQuality.ts`.

**Tech Stack:** React + TypeScript (Vite), Vitest + @testing-library/react (jsdom). Frontend only — no C# touched.

**Spec:** `docs/superpowers/specs/2026-07-16-livekit-sidebar-stats-tooltip-design.md` (approved, source of truth).

---

## File Structure

| Path | Change |
| --- | --- |
| `src/Brmble.Web/src/components/Sidebar/livekitTooltip.ts` | Create — pure `buildLiveKitTooltip` helper + `LiveKitTooltipInput` type |
| `src/Brmble.Web/src/components/Sidebar/livekitTooltip.test.ts` | Create — thorough unit tests for the helper |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` | Modify — add 4 new props, delegate `dotTooltip('livekit')` to helper |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx` | Modify — keep/adjust existing tooltip test, add integration cases |
| `src/Brmble.Web/src/App.tsx` | Modify — preformat `broadcastSummary`, pass 4 new props to `<Sidebar>` |

---

## Design Contract (locked)

Given service name `name` (actual `SERVICE_DISPLAY_NAMES.livekit === 'Screenshare'`), the livekit tooltip (when no `error`) is built as:

1. **Not in a room, connected** → `` `${name}: Available` `` (unchanged).
2. **In a room, quality `reconnecting`** → `` `${name}: Reconnecting` `` (unchanged).
3. **In a room** → first line is the existing aggregate:
   - if `quality !== 'unknown'` → `` `${name}: Connected - ${quality}` ``
   - else → `` `${name}: Connected` ``
   Then append, in order:
   - If `isSharing` and `broadcastSummary` is a non-empty string → line `` `Broadcasting: ${broadcastSummary}` ``.
   - If `watchingShares.length > 0` → line `` `Watching ${n} share${n === 1 ? '' : 's'}` ``, then one line per share.
4. **Per-share line** for a share `s` (key = `s.userId`):
   - `label` = `s.userName` if non-empty (after trim), else `String(s.matrixUserId ?? s.userId)`.
   - `q` = `shareQualities.get(s.userId)` (may be `undefined`).
   - `el` = `remoteVideoEls.get(s.userId)`; `w = el?.videoWidth ?? 0`, `h = el?.videoHeight ?? 0`.
   - `res` = (`w > 0 && h > 0`) ? `` `${w}×${h}` `` : `''` (U+00D7 MULTIPLICATION SIGN `×`).
   - `qualSuffix` = (`q && q !== 'unknown'`) ? `` ` (${q})` `` : `''`.
   - Compose: with res → `` `${label}: ${res}${qualSuffix}` ``; without res → `` `${label}${qualSuffix}` ``.
5. **Fallthrough** (not connected / other services / has error) is handled by the existing `dotTooltip` code, NOT the helper. The helper is only invoked for the `svc === 'livekit' && !error` branch and returns `null` when it has nothing livekit-specific to say, so `dotTooltip` can fall through to its existing generic return.

`broadcastSummary` (built in `App.tsx`) = `` `${screenShareSettings.resolution} ${screenShareSettings.fps}fps` `` when `isSharing`, else `undefined` (e.g. `1080p 30fps`).

---

## Task 1: Pure `buildLiveKitTooltip` helper

**Files:**
- Create: `src/Brmble.Web/src/components/Sidebar/livekitTooltip.ts`
- Create: `src/Brmble.Web/src/components/Sidebar/livekitTooltip.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/Brmble.Web/src/components/Sidebar/livekitTooltip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLiveKitTooltip } from './livekitTooltip';
import type { LiveKitTooltipInput } from './livekitTooltip';
import type { ShareInfo } from '../../hooks/useScreenShare';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';

const NAME = 'Screenshare';

const makeShare = (overrides: Partial<ShareInfo> = {}): ShareInfo => ({
  roomName: 'channel-0',
  userName: 'Alice',
  userId: 42,
  matrixUserId: '@alice:example.com',
  sessionId: 2,
  ...overrides,
});

/** Minimal fake video element exposing only the dimensions the helper reads. */
const fakeVideo = (videoWidth: number, videoHeight: number): HTMLVideoElement =>
  ({ videoWidth, videoHeight } as HTMLVideoElement);

const base = (overrides: Partial<LiveKitTooltipInput> = {}): LiveKitTooltipInput => ({
  name: NAME,
  connected: true,
  isLiveKitRoomConnected: false,
  screenShareQuality: 'unknown',
  isSharing: false,
  broadcastSummary: undefined,
  watchingShares: [],
  shareQualities: new Map<number, ScreenShareQuality>(),
  remoteVideoEls: new Map<number, HTMLVideoElement>(),
  ...overrides,
});

describe('buildLiveKitTooltip', () => {
  it('returns Available when connected with no active room', () => {
    expect(buildLiveKitTooltip(base())).toBe(`${NAME}: Available`);
  });

  it('returns Reconnecting when in a room and quality is reconnecting', () => {
    expect(
      buildLiveKitTooltip(base({ isLiveKitRoomConnected: true, screenShareQuality: 'reconnecting' })),
    ).toBe(`${NAME}: Reconnecting`);
  });

  it('returns null when not connected (lets dotTooltip fall through)', () => {
    expect(buildLiveKitTooltip(base({ connected: false }))).toBeNull();
  });

  it('shows the aggregate quality line when in a room', () => {
    expect(
      buildLiveKitTooltip(base({ isLiveKitRoomConnected: true, screenShareQuality: 'good' })),
    ).toBe(`${NAME}: Connected - good`);
  });

  it('omits the quality suffix on the first line when quality is unknown but a share is active', () => {
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'unknown',
          isSharing: true,
          broadcastSummary: '1080p 30fps',
        }),
      ),
    ).toBe(`${NAME}: Connected\nBroadcasting: 1080p 30fps`);
  });

  it('adds a Broadcasting line when sharing', () => {
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          isSharing: true,
          broadcastSummary: '1440p 60fps',
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nBroadcasting: 1440p 60fps`);
  });

  it('does not add a Broadcasting line when sharing but summary is missing', () => {
    expect(
      buildLiveKitTooltip(
        base({ isLiveKitRoomConnected: true, screenShareQuality: 'good', isSharing: true }),
      ),
    ).toBe(`${NAME}: Connected - good`);
  });

  it('adds a singular Watching line plus a per-share line with resolution and quality', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080 (good)`);
  });

  it('pluralizes the Watching line for two shares', () => {
    const a = makeShare({ userId: 42, userName: 'Alice' });
    const b = makeShare({ userId: 7, userName: 'Bob' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'fair',
          watchingShares: [a, b],
          shareQualities: new Map([
            [42, 'good'],
            [7, 'poor'],
          ]),
          remoteVideoEls: new Map([
            [42, fakeVideo(1920, 1080)],
            [7, fakeVideo(1280, 720)],
          ]),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - fair\nWatching 2 shares\nAlice: 1920×1080 (good)\nBob: 1280×720 (poor)`,
    );
  });

  it('shows Broadcasting and Watching together', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          isSharing: true,
          broadcastSummary: '1080p 30fps',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - good\nBroadcasting: 1080p 30fps\nWatching 1 share\nAlice: 1920×1080 (good)`,
    );
  });

  it('omits the resolution when the video element has no dimensions', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(0, 0)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice (good)`);
  });

  it('omits the resolution when there is no video element at all', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'fair']]),
          remoteVideoEls: new Map(),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice (fair)`);
  });

  it('omits the quality suffix when the per-share quality is unknown', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'unknown']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080`);
  });

  it('omits the quality suffix when the per-share quality is missing entirely', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map(),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080`);
  });

  it('falls back to matrixUserId then userId when the userName is empty', () => {
    const named = makeShare({ userId: 42, userName: '   ' });
    const noMatrix = makeShare({ userId: 7, userName: '', matrixUserId: undefined });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [named, noMatrix],
          shareQualities: new Map(),
          remoteVideoEls: new Map(),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - good\nWatching 2 shares\n@alice:example.com\n7`,
    );
  });
});
```

Run and confirm failure (module does not exist yet):

```
cd src/Brmble.Web
npx vitest run src/components/Sidebar/livekitTooltip.test.ts
```

- [ ] **Step 1.2: Implement the helper**

Create `src/Brmble.Web/src/components/Sidebar/livekitTooltip.ts`:

```ts
import type { ShareInfo } from '../../hooks/useScreenShare';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';

export interface LiveKitTooltipInput {
  /** Display name for the service (e.g. 'Screenshare'). */
  name: string;
  /** Whether the underlying livekit service status is 'connected'. */
  connected: boolean;
  /** True when a LiveKit room is active (sharing and/or watching). */
  isLiveKitRoomConnected: boolean;
  /** Aggregate room quality. */
  screenShareQuality: ScreenShareQuality;
  /** True when the local user is broadcasting a share. */
  isSharing: boolean;
  /** Preformatted broadcast summary, e.g. '1080p 30fps'. Undefined when not broadcasting. */
  broadcastSummary?: string;
  /** Shares the local user is currently watching. */
  watchingShares: ShareInfo[];
  /** Per-share quality keyed by ShareInfo.userId. */
  shareQualities: Map<number, ScreenShareQuality>;
  /** Live remote <video> elements keyed by ShareInfo.userId (for live dimensions). */
  remoteVideoEls: Map<number, HTMLVideoElement>;
}

/**
 * Builds the multi-line LiveKit/Screenshare status tooltip string.
 *
 * Pure: inputs -> string. Returns `null` when there is nothing livekit-specific
 * to say (e.g. not connected), so the caller can fall through to its generic
 * tooltip. Uses the existing `\n` multi-line convention shared with the voice
 * and server tooltips.
 */
export function buildLiveKitTooltip(input: LiveKitTooltipInput): string | null {
  const {
    name,
    connected,
    isLiveKitRoomConnected,
    screenShareQuality,
    isSharing,
    broadcastSummary,
    watchingShares,
    shareQualities,
    remoteVideoEls,
  } = input;

  if (connected && !isLiveKitRoomConnected) {
    return `${name}: Available`;
  }

  if (isLiveKitRoomConnected && screenShareQuality === 'reconnecting') {
    return `${name}: Reconnecting`;
  }

  if (!(connected && isLiveKitRoomConnected)) {
    return null;
  }

  const firstLine =
    screenShareQuality !== 'unknown'
      ? `${name}: Connected - ${screenShareQuality}`
      : `${name}: Connected`;

  const lines: string[] = [firstLine];

  if (isSharing && broadcastSummary) {
    lines.push(`Broadcasting: ${broadcastSummary}`);
  }

  if (watchingShares.length > 0) {
    const n = watchingShares.length;
    lines.push(`Watching ${n} share${n === 1 ? '' : 's'}`);
    for (const share of watchingShares) {
      lines.push(buildShareLine(share, shareQualities, remoteVideoEls));
    }
  }

  return lines.join('\n');
}

function buildShareLine(
  share: ShareInfo,
  shareQualities: Map<number, ScreenShareQuality>,
  remoteVideoEls: Map<number, HTMLVideoElement>,
): string {
  const trimmedName = share.userName?.trim() ?? '';
  const label = trimmedName !== '' ? trimmedName : String(share.matrixUserId ?? share.userId);

  const el = remoteVideoEls.get(share.userId);
  const w = el?.videoWidth ?? 0;
  const h = el?.videoHeight ?? 0;
  const res = w > 0 && h > 0 ? `${w}\u00D7${h}` : '';

  const q = shareQualities.get(share.userId);
  const qualSuffix = q && q !== 'unknown' ? ` (${q})` : '';

  return res !== '' ? `${label}: ${res}${qualSuffix}` : `${label}${qualSuffix}`;
}
```

- [ ] **Step 1.3: Confirm the tests pass**

```
cd src/Brmble.Web
npx vitest run src/components/Sidebar/livekitTooltip.test.ts
```

All cases green.

- [ ] **Step 1.4: Commit**

```
git add src/Brmble.Web/src/components/Sidebar/livekitTooltip.ts src/Brmble.Web/src/components/Sidebar/livekitTooltip.test.ts
git commit -m "feat: add pure buildLiveKitTooltip screenshare stats string builder"
```

---

## Task 2: Wire the helper into `Sidebar`

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`

- [ ] **Step 2.1: Update the existing tooltip test and add integration cases**

The `Screenshare: Connected - poor` test at `Sidebar.test.tsx` (~line 217) must keep passing unchanged (backward compat). Add new integration cases after it that exercise the new props end-to-end through the rendered dot's `aria-label`.

In `Sidebar.test.tsx`, add these tests immediately after the existing `it('shows active Screenshare quality in service status tooltip text', ...)` block (~line 224):

```tsx
  it('adds a Broadcasting line to the Screenshare tooltip when sharing', () => {
    renderSidebar({
      isLiveKitRoomConnected: true,
      screenShareQuality: 'good',
      isSharing: true,
      broadcastSummary: '1080p 30fps',
    });

    expect(
      screen.getByLabelText('Screenshare: Connected - good\nBroadcasting: 1080p 30fps'),
    ).toBeInTheDocument();
  });

  it('adds a Watching line and a per-share resolution line to the Screenshare tooltip', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    renderSidebar({
      isLiveKitRoomConnected: true,
      screenShareQuality: 'good',
      watchingShares: [share],
      shareQualities: new Map([[42, 'good']]),
      remoteVideoEls: new Map([[42, video]]),
    });

    expect(
      screen.getByLabelText('Screenshare: Connected - good\nWatching 1 share\nAlice: 1920×1080 (good)'),
    ).toBeInTheDocument();
  });

  it('pluralizes the Watching line for two watched shares', () => {
    const a = makeShare({ userId: 42, userName: 'Alice' });
    const b = makeShare({ userId: 7, userName: 'Bob' });

    renderSidebar({
      isLiveKitRoomConnected: true,
      screenShareQuality: 'fair',
      watchingShares: [a, b],
      shareQualities: new Map([
        [42, 'good'],
        [7, 'poor'],
      ]),
      remoteVideoEls: new Map([
        [42, { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement],
        [7, { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement],
      ]),
    });

    expect(
      screen.getByLabelText(
        'Screenshare: Connected - fair\nWatching 2 shares\nAlice: 1920×1080 (good)\nBob: 1280×720 (poor)',
      ),
    ).toBeInTheDocument();
  });

  it('omits the per-share resolution when the video element has no dimensions', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });

    renderSidebar({
      isLiveKitRoomConnected: true,
      screenShareQuality: 'good',
      watchingShares: [share],
      shareQualities: new Map([[42, 'good']]),
      remoteVideoEls: new Map([[42, { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement]]),
    });

    expect(
      screen.getByLabelText('Screenshare: Connected - good\nWatching 1 share\nAlice (good)'),
    ).toBeInTheDocument();
  });
```

Run and confirm the four new cases fail (props not yet consumed) while the existing case still passes:

```
cd src/Brmble.Web
npx vitest run src/components/Sidebar/Sidebar.test.tsx
```

- [ ] **Step 2.2: Add the new props to `SidebarProps` and destructuring**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`, extend the imports if needed — `ShareInfo` (line 13) and `ScreenShareQuality` (line 14) are already imported. Add the new import for the helper near the other local imports (after line 14):

```tsx
import { buildLiveKitTooltip } from './livekitTooltip';
```

Add the four new optional props to the `SidebarProps` interface. Replace lines 48-51:

```tsx
  activeShares?: ShareInfo[];
  watchingShares?: ShareInfo[];
  isLiveKitRoomConnected?: boolean;
  screenShareQuality?: ScreenShareQuality;
```

with:

```tsx
  activeShares?: ShareInfo[];
  watchingShares?: ShareInfo[];
  isLiveKitRoomConnected?: boolean;
  screenShareQuality?: ScreenShareQuality;
  isSharing?: boolean;
  broadcastSummary?: string;
  shareQualities?: Map<number, ScreenShareQuality>;
  remoteVideoEls?: Map<number, HTMLVideoElement>;
```

Add matching destructuring with safe defaults. Replace lines 79-82:

```tsx
  activeShares,
  watchingShares,
  isLiveKitRoomConnected = false,
  screenShareQuality = 'unknown',
```

with:

```tsx
  activeShares,
  watchingShares,
  isLiveKitRoomConnected = false,
  screenShareQuality = 'unknown',
  isSharing = false,
  broadcastSummary,
  shareQualities,
  remoteVideoEls,
```

- [ ] **Step 2.3: Delegate the livekit branch in `dotTooltip` to the helper**

In `dotTooltip` (lines 129-162), replace the entire livekit block (lines 135-147):

```tsx
    if (svc === 'livekit' && !error) {
      if (status.state === 'connected' && !isLiveKitRoomConnected) {
        return `${name}: Available`;
      }

      if (isLiveKitRoomConnected && screenShareQuality === 'reconnecting') {
        return `${name}: Reconnecting`;
      }

      if (status.state === 'connected' && isLiveKitRoomConnected && screenShareQuality !== 'unknown') {
        return `${name}: Connected - ${screenShareQuality}`;
      }
    }
```

with:

```tsx
    if (svc === 'livekit' && !error) {
      const livekitTooltip = buildLiveKitTooltip({
        name,
        connected: status.state === 'connected',
        isLiveKitRoomConnected,
        screenShareQuality,
        isSharing,
        broadcastSummary,
        watchingShares: watchingShares ?? [],
        shareQualities: shareQualities ?? new Map(),
        remoteVideoEls: remoteVideoEls ?? new Map(),
      });

      if (livekitTooltip !== null) {
        return livekitTooltip;
      }
    }
```

Note: this preserves the existing fall-through behavior — when the helper returns `null` (e.g. not connected, or connected+in-room+`unknown` quality with no active shares), `dotTooltip` continues to its generic `${name}: ${state}` return at the end, exactly matching the prior code path.

- [ ] **Step 2.4: Confirm all Sidebar tests pass**

```
cd src/Brmble.Web
npx vitest run src/components/Sidebar/Sidebar.test.tsx
```

Existing tooltip/backward-compat cases and the four new cases all green.

- [ ] **Step 2.5: Commit**

```
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
git commit -m "feat: render screenshare broadcast/watch stats in sidebar livekit tooltip"
```

---

## Task 3: Thread the props from `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

`useScreenShare` is already destructured at `App.tsx:3473` exposing `isSharing`, `watchingShares`, `remoteVideoEls`, `shareQualities`, `roomQuality`. `screenShareSettings` state is at `App.tsx:3334`. No new hooks/state needed.

- [ ] **Step 3.1: Preformat `broadcastSummary` near the Sidebar render**

Just before the `return`/JSX that renders `<Sidebar>` (the block starting at `App.tsx:4087`), the value is derived inline. Add the four new props to the `<Sidebar ... />` element. Locate the existing props (App.tsx:4108-4111):

```tsx
          activeShares={activeShares}
          watchingShares={watchingShares}
          isLiveKitRoomConnected={isSharing || watchingShares.length > 0}
          screenShareQuality={roomQuality}
```

Replace with:

```tsx
          activeShares={activeShares}
          watchingShares={watchingShares}
          isLiveKitRoomConnected={isSharing || watchingShares.length > 0}
          screenShareQuality={roomQuality}
          isSharing={isSharing}
          broadcastSummary={isSharing ? `${screenShareSettings.resolution} ${screenShareSettings.fps}fps` : undefined}
          shareQualities={shareQualities}
          remoteVideoEls={remoteVideoEls}
```

- [ ] **Step 3.2: Typecheck + build**

```
cd src/Brmble.Web
npm run build
```

`tsc -b` clean, vite build succeeds. (`broadcastSummary` type is `string | undefined`, `shareQualities`/`remoteVideoEls` are the exact `Map` types Sidebar expects.)

- [ ] **Step 3.3: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: pass screenshare broadcast/watch stats to Sidebar tooltip"
```

---

## Task 4: Full verification & self-review

- [ ] **Step 4.1: Run the full frontend suite**

```
cd src/Brmble.Web
npx vitest run
```

Expect the prior 935 tests plus the new livekitTooltip cases and four new Sidebar cases, all passing. No regressions.

- [ ] **Step 4.2: Build + lint**

```
cd src/Brmble.Web
npm run build
npm run lint
```

Build clean. Lint must show **no new** problems beyond the known pre-existing baseline (16 problems: 15 errors, 1 warning in the `useScreenShare` files). New files (`livekitTooltip.ts`, `livekitTooltip.test.ts`) and the Sidebar/App edits must contribute zero lint issues.

- [ ] **Step 4.3: Spec coverage self-review**

Confirm against `docs/superpowers/specs/2026-07-16-livekit-sidebar-stats-tooltip-design.md`:
- [ ] Available / Reconnecting lines unchanged.
- [ ] Broadcasting line present with `<resolution> <fps>fps` when sharing.
- [ ] `Watching N share(s)` line with correct singular/plural.
- [ ] Per-share line `<name>: <W>×<H> (<quality>)`; resolution omitted when video has no dimensions; `(quality)` omitted when quality is `unknown`/missing; name falls back to matrixUserId then userId.
- [ ] First line remains the existing aggregate `Connected - <quality>` (or `Connected` when `unknown`).
- [ ] Only `Sidebar.tsx`, `App.tsx`, and the two new helper files changed. No changes to `useScreenShare`, `Tooltip`, `screenShareQuality.ts`, or `UI_GUIDE.md`.
- [ ] No `getStats()` plumbing added.
- [ ] Uses the shared `<Tooltip content>` (string, `\n`) mechanism — no native `title`.

- [ ] **Step 4.4: Placeholder / hardcoded-value scan**

- [ ] No TODO/placeholder left in the new code.
- [ ] No hardcoded colors/spacing/fonts (this feature adds only string text, no CSS).

---

## Notes / Out of Scope

- The `docker-local/docker-compose.yml` and `src/Brmble.Server/docker/livekit.yaml` UDP port changes remain uncommitted by design — NOT part of this feature's commits or any PR.
- Accepted edge case (from spec): resolution may be stale by one render since `dotTooltip` is computed during render, not on hover. Acceptable for a glance.
- Branch: `feature/screenshare-quality`. Do NOT push or open a PR without the user's explicit go-ahead (CLAUDE.md branch rules).
