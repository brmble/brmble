# Multi-Share Layouts (A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-stream `ScreenShareViewer` with a multi-view `ScreenShareGrid` that supports 1-4 simultaneous streams, equal grid layout, and click-to-focus with thumbnails.

**Architecture:** The `useScreenShare` hook changes from tracking a single `watchingShare` to an array `watchingShares[]` (max 4) with a `focusedShare` state. A new `ScreenShareGrid` component replaces `ScreenShareViewer`, rendering `ScreenShareTile` sub-components in grid or focused layout. The sidebar monitor icon becomes a toggle (click to start/stop watching). All streams use the existing single LiveKit room connection.

**Tech Stack:** React, TypeScript, Vitest, LiveKit client SDK, CSS custom properties (design tokens from `docs/UI_GUIDE.md`)

**Spec:** `docs/superpowers/specs/2026-04-20-multi-share-layouts-design.md`

---

### Task 1: Refactor `useScreenShare` hook — multi-watch state

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

This task changes the hook's state model from single-watch to multi-watch. The public API changes so that consumers can manage multiple watched streams.

- [ ] **Step 1: Write failing tests for multi-watch state**

Add these tests to `useScreenShare.test.ts`:

```typescript
it('exposes watchingShares as empty array initially', () => {
  const { result } = renderHook(() => useScreenShare());
  expect(result.current.watchingShares).toEqual([]);
  expect(result.current.focusedShare).toBeNull();
});

it('exposes remoteVideoEls as empty Map initially', () => {
  const { result } = renderHook(() => useScreenShare());
  expect(result.current.remoteVideoEls).toBeInstanceOf(Map);
  expect(result.current.remoteVideoEls.size).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/Brmble.Web && npx vitest run src/hooks/useScreenShare.test.ts`
Expected: FAIL — `watchingShares` and `focusedShare` and `remoteVideoEls` don't exist yet.

- [ ] **Step 3: Refactor hook state from single to multi-watch**

In `useScreenShare.ts`, replace:

```typescript
const [watchingShare, setWatchingShare] = useState<ShareInfo | null>(null);
const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);
const watchingShareRef = useRef<ShareInfo | null>(null);
```

With:

```typescript
const [watchingShares, setWatchingShares] = useState<ShareInfo[]>([]);
const [focusedShare, setFocusedShare] = useState<ShareInfo | null>(null);
const [remoteVideoEls, setRemoteVideoEls] = useState<Map<number, HTMLVideoElement>>(new Map());
const watchingSharesRef = useRef<ShareInfo[]>([]);
```

Replace `updateWatchingShare`:

```typescript
const updateWatchingShares = useCallback((shares: ShareInfo[]) => {
  watchingSharesRef.current = shares;
  setWatchingShares(shares);
}, []);

const addWatchingShare = useCallback((share: ShareInfo) => {
  setWatchingShares(prev => {
    if (prev.some(s => s.userId === share.userId)) return prev;
    const next = prev.length >= 4
      ? [...prev.slice(1), share]  // drop oldest (index 0) if at max
      : [...prev, share];
    watchingSharesRef.current = next;
    return next;
  });
}, []);

const removeWatchingShare = useCallback((userId: number) => {
  setWatchingShares(prev => {
    const next = prev.filter(s => s.userId !== userId);
    watchingSharesRef.current = next;
    return next;
  });
  setFocusedShare(prev => prev?.userId === userId ? null : prev);
  setRemoteVideoEls(prev => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
}, []);
```

Add backward-compat shims at the bottom of the hook return:

```typescript
// Backward compat — will be removed once ChatPanel migrates to ScreenShareGrid
const watchingShare = watchingShares.length > 0 ? watchingShares[0] : null;
const remoteVideoEl = remoteVideoEls.size > 0 ? remoteVideoEls.values().next().value ?? null : null;
```

Update the return object to include new fields:

```typescript
return {
  isSharing,
  startSharing,
  stopSharing,
  error,
  activeShare,
  activeShares,
  watchingShare,       // backward compat
  watchingShares,      // new: array of watched shares
  focusedShare,        // new: which share is focused
  setFocusedShare,     // new: set focus
  remoteVideoEl,       // backward compat
  remoteVideoEls,      // new: Map<userId, HTMLVideoElement>
  disconnectViewer,
  connectAsViewer,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/Brmble.Web && npx vitest run src/hooks/useScreenShare.test.ts`
Expected: All tests PASS including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "refactor: add multi-watch state to useScreenShare hook"
```

---

### Task 2: Refactor `connectAsViewer` and `disconnectViewer` for multi-watch

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

This task changes `connectAsViewer` to add streams to the array (with toggle behavior) and `disconnectViewer` to remove individual streams.

- [ ] **Step 1: Write failing tests**

Add to `useScreenShare.test.ts`:

```typescript
it('connectAsViewer toggles: first call adds, second call removes same user', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  // Add an active share
  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });

  // First call: adds to watchingShares
  await act(async () => {
    const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    tokenHandler?.({ token: 'jwt', url: 'ws://localhost/livekit' });
    await p;
  });
  expect(result.current.watchingShares).toHaveLength(1);
  expect(result.current.watchingShares[0].userId).toBe(10);

  // Second call: removes (toggle off)
  await act(async () => {
    await result.current.connectAsViewer('channel-1', 10, '@alice:test');
  });
  expect(result.current.watchingShares).toHaveLength(0);
});

it('connectAsViewer adds multiple users up to 4', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  // Add active shares
  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20 });
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'charlie', userId: 30 });
  });

  // Connect to all three
  for (const uid of [10, 20, 30]) {
    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', uid);
      if (uid === 10) tokenHandler?.({ token: 'jwt', url: 'ws://localhost/livekit' });
      await p;
    });
  }
  expect(result.current.watchingShares).toHaveLength(3);
});

it('disconnectViewer with userId removes only that stream', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20 });
  });

  await act(async () => {
    const p = result.current.connectAsViewer('channel-1', 10);
    tokenHandler?.({ token: 'jwt', url: 'ws://localhost/livekit' });
    await p;
  });
  await act(async () => {
    await result.current.connectAsViewer('channel-1', 20);
  });
  expect(result.current.watchingShares).toHaveLength(2);

  await act(async () => {
    await result.current.disconnectViewer(10);
  });
  expect(result.current.watchingShares).toHaveLength(1);
  expect(result.current.watchingShares[0].userId).toBe(20);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/Brmble.Web && npx vitest run src/hooks/useScreenShare.test.ts`
Expected: FAIL — `connectAsViewer` doesn't do toggle, `disconnectViewer` doesn't accept userId.

- [ ] **Step 3: Rewrite `connectAsViewer` for multi-watch with toggle**

Replace the existing `connectAsViewer` in `useScreenShare.ts`:

```typescript
const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
  // Toggle: if already watching this user, remove them
  if (watchingSharesRef.current.some(s => s.userId === targetUserId)) {
    // Detach track
    const room = roomRef.current;
    if (room) {
      const identity = matrixUserId ?? String(targetUserId);
      const participant = room.remoteParticipants.get(identity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            pub.track.detach();
          }
        });
      }
    }
    removeWatchingShare(targetUserId);
    // Disconnect room if nothing left
    if (watchingSharesRef.current.length === 0) {
      await maybeDisconnectRoom();
    }
    return;
  }

  const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
  const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);
  const newShare: ShareInfo = shareInfo ?? { roomName, userName: '', userId: targetUserId, matrixUserId };

  try {
    const room = await ensureRoom(roomName);

    // Add to watching list (handles max 4 enforcement via addWatchingShare)
    addWatchingShare(newShare);

    // Subscribe to the target's screen share track
    const participant = room.remoteParticipants.get(participantIdentity);
    if (participant) {
      participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
        if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
          const el = pub.track.attach() as HTMLVideoElement;
          setRemoteVideoEls(prev => new Map(prev).set(targetUserId, el));
        }
      });
    }
    // If track not yet available, TrackSubscribed event will pick it up
  } catch (err) {
    console.error('Failed to connect as viewer:', err);
  }
}, [activeShares, ensureRoom, addWatchingShare, removeWatchingShare, maybeDisconnectRoom]);
```

- [ ] **Step 4: Rewrite `disconnectViewer` to accept optional userId**

Replace the existing `disconnectViewer`:

```typescript
const disconnectViewer = useCallback(async (userId?: number) => {
  const room = roomRef.current;

  if (userId !== undefined) {
    // Remove a specific stream
    const share = watchingSharesRef.current.find(s => s.userId === userId);
    if (share && room) {
      const targetIdentity = share.matrixUserId ?? String(share.userId);
      const participant = room.remoteParticipants.get(targetIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            pub.track.detach();
          }
        });
      }
    }
    removeWatchingShare(userId);
    if (watchingSharesRef.current.length === 0) {
      await maybeDisconnectRoom();
    }
    return;
  }

  // No userId: remove all streams (channel switch / full cleanup)
  if (room) {
    for (const share of watchingSharesRef.current) {
      const targetIdentity = share.matrixUserId ?? String(share.userId);
      const participant = room.remoteParticipants.get(targetIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            pub.track.detach();
          }
        });
      }
    }
  }
  setRemoteVideoEls(new Map());
  updateWatchingShares([]);
  setFocusedShare(null);
  await maybeDisconnectRoom();
}, [removeWatchingShare, updateWatchingShares, maybeDisconnectRoom]);
```

- [ ] **Step 5: Update `maybeDisconnectRoom` to check array**

```typescript
const maybeDisconnectRoom = useCallback(async () => {
  if (!isSharingRef.current && watchingSharesRef.current.length === 0 && roomRef.current) {
    try { await roomRef.current.disconnect(); } catch { /* ignore */ }
    roomRef.current = null;
  }
}, []);
```

- [ ] **Step 6: Update `TrackSubscribed` handler in `ensureRoom`**

The `TrackSubscribed` handler now needs to check against ALL watched shares, not just one:

```typescript
room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
  const watching = watchingSharesRef.current;
  const matchedShare = watching.find(s => {
    const identity = s.matrixUserId ?? String(s.userId);
    return identity === participant.identity;
  });
  if (!matchedShare) return;
  if (
    track.kind === Track.Kind.Video &&
    track.source === Track.Source.ScreenShare
  ) {
    const el = track.attach() as HTMLVideoElement;
    setRemoteVideoEls(prev => new Map(prev).set(matchedShare.userId, el));
  }
});

room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
  const watching = watchingSharesRef.current;
  const matchedShare = watching.find(s => {
    const identity = s.matrixUserId ?? String(s.userId);
    return identity === participant.identity;
  });
  if (!matchedShare) return;
  if (
    track.kind === Track.Kind.Video &&
    track.source === Track.Source.ScreenShare
  ) {
    track.detach();
    setRemoteVideoEls(prev => {
      const next = new Map(prev);
      next.delete(matchedShare.userId);
      return next;
    });
  }
});
```

- [ ] **Step 7: Update `onShareStopped` handler for multi-watch**

In the `useEffect` bridge listener, replace the `onShareStopped` handler:

```typescript
const onShareStopped = (data: unknown) => {
  const d = data as { roomName: string; userId: number };
  setActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));

  // If we were watching this user, remove their tile
  const wasWatching = watchingSharesRef.current.some(s => s.roomName === d.roomName && s.userId === d.userId);
  if (wasWatching) {
    const room = roomRef.current;
    if (room) {
      const share = watchingSharesRef.current.find(s => s.userId === d.userId);
      if (share) {
        const targetIdentity = share.matrixUserId ?? String(share.userId);
        const participant = room.remoteParticipants.get(targetIdentity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
      }
    }
    removeWatchingShare(d.userId);
    // Disconnect room if nothing left and not sharing
    if (watchingSharesRef.current.length === 0 && !isSharingRef.current && room) {
      room.disconnect().catch(() => {});
      roomRef.current = null;
    }
  }
};
```

- [ ] **Step 8: Update `Disconnected` handler for multi-watch**

```typescript
room.on(RoomEvent.Disconnected, () => {
  roomRef.current = null;
  setRemoteVideoEls(new Map());
  if (isSharingRef.current) {
    setIsSharing(false);
    isSharingRef.current = false;
    onDisconnectedRef.current?.();
  }
  updateWatchingShares([]);
  setFocusedShare(null);
});
```

- [ ] **Step 9: Update existing tests for new API shape**

Update the existing test `'starts in idle state with empty activeShares'` to check the new fields:

```typescript
it('starts in idle state with empty activeShares', () => {
  const { result } = renderHook(() => useScreenShare());
  expect(result.current.isSharing).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.activeShares).toEqual([]);
  expect(result.current.watchingShares).toEqual([]);
  expect(result.current.watchingShare).toBeNull(); // backward compat
  expect(result.current.focusedShare).toBeNull();
});
```

- [ ] **Step 10: Run all tests**

Run: `cd src/Brmble.Web && npx vitest run src/hooks/useScreenShare.test.ts`
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "refactor: multi-watch connectAsViewer with toggle and disconnectViewer by userId"
```

---

### Task 3: Create `ScreenShareTile` component

**Files:**
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.tsx`
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.css`
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.test.tsx`

This is the individual tile — a video element with name label, close button, and fullscreen button.

- [ ] **Step 1: Write failing test**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenShareTile } from './ScreenShareTile';

describe('ScreenShareTile', () => {
  const createVideoEl = () => {
    const el = document.createElement('video');
    return el;
  };

  it('renders sharer name', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Alice's screen")).toBeTruthy();
  });

  it('calls onClick when tile is clicked', () => {
    const onClick = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={onClick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('screen-share-tile'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Stop watching'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not propagate close click to tile onClick', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={onClick} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Stop watching'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('adds focused class when isFocused is true', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={true} isThumbnail={false} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('screen-share-tile').classList.contains('screen-share-tile--focused')).toBe(true);
  });

  it('adds thumbnail class when isThumbnail is true', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={true} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('screen-share-tile').classList.contains('screen-share-tile--thumbnail')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/Brmble.Web && npx vitest run src/components/ScreenShareGrid/ScreenShareTile.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScreenShareTile`**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.tsx`:

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';
import './ScreenShareTile.css';

interface ScreenShareTileProps {
  videoEl: HTMLVideoElement;
  sharerName: string;
  isFocused: boolean;
  isThumbnail: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function ScreenShareTile({ videoEl, sharerName, isFocused, isThumbnail, onClick, onClose }: ScreenShareTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    videoEl.className = 'screen-share-tile-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    return () => {
      videoEl.pause();
      videoEl.srcObject = null;
      if (container.contains(videoEl)) {
        container.removeChild(videoEl);
      }
    };
  }, [videoEl]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowControls(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const className = [
    'screen-share-tile',
    isFocused ? 'screen-share-tile--focused' : '',
    isThumbnail ? 'screen-share-tile--thumbnail' : '',
    showControls ? 'show-controls' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      ref={containerRef}
      data-testid="screen-share-tile"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="screen-share-tile-overlay screen-share-tile-overlay--name">
        {sharerName}'s screen
      </div>
      <div className="screen-share-tile-overlay screen-share-tile-overlay--close">
        <Tooltip content="Stop watching">
          <button
            className="btn btn-ghost btn-icon screen-share-tile-control-btn"
            onClick={handleClose}
            aria-label="Stop watching"
          >
            <Icon name="x" size={16} />
          </button>
        </Tooltip>
      </div>
      {!isThumbnail && (
        <div className="screen-share-tile-overlay screen-share-tile-overlay--controls">
          <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <button
              className="btn btn-ghost btn-icon screen-share-tile-control-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <Icon name="minimize-2" size={16} />
              ) : (
                <Icon name="maximize-2" size={16} />
              )}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `ScreenShareTile.css`**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareTile.css`:

```css
.screen-share-tile {
  position: relative;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  border-radius: var(--radius-sm);
  border: 2px solid transparent;
  transition: border-color var(--transition-normal);
}

.screen-share-tile:hover {
  border-color: var(--border-hover);
}

.screen-share-tile--focused {
  border-color: var(--accent-primary);
}

.screen-share-tile--thumbnail {
  cursor: pointer;
}

.screen-share-tile-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--bg-deep);
  pointer-events: none;
}

/* Overlays */
.screen-share-tile-overlay {
  position: absolute;
  z-index: 2;
  opacity: 0;
  transition: opacity var(--transition-normal);
  pointer-events: none;
}

.screen-share-tile.show-controls .screen-share-tile-overlay {
  opacity: 1;
}

/* Name label — always visible */
.screen-share-tile-overlay--name {
  bottom: var(--space-xs);
  left: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-deep-glass);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-primary);
  opacity: 1;
}

/* Close button — always visible */
.screen-share-tile-overlay--close {
  top: var(--space-xs);
  right: var(--space-xs);
  pointer-events: auto;
  opacity: 1;
}

/* Fullscreen button — hover only */
.screen-share-tile-overlay--controls {
  top: var(--space-xs);
  right: calc(var(--space-xs) + 28px + var(--space-xs));
  display: flex;
  gap: var(--space-xs);
  pointer-events: auto;
}

.screen-share-tile-control-btn {
  background: var(--bg-deep-glass) !important;
  color: var(--text-primary) !important;
  border-radius: var(--radius-sm) !important;
  width: 28px;
  height: 28px;
}

.screen-share-tile-control-btn:hover {
  background: var(--bg-hover-strong) !important;
}

/* Thumbnail adjustments */
.screen-share-tile--thumbnail .screen-share-tile-overlay--name {
  font-size: 10px;
  padding: 1px var(--space-xs);
}

.screen-share-tile--thumbnail .screen-share-tile-control-btn {
  width: 22px;
  height: 22px;
}
```

- [ ] **Step 5: Run tests**

Run: `cd src/Brmble.Web && npx vitest run src/components/ScreenShareGrid/ScreenShareTile.test.tsx`
Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ScreenShareGrid/
git commit -m "feat: add ScreenShareTile component"
```

---

### Task 4: Create `ScreenShareGrid` component

**Files:**
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.tsx`
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.css`
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.test.tsx`
- Create: `src/Brmble.Web/src/components/ScreenShareGrid/index.ts`

This is the container that arranges tiles based on count and focus state.

- [ ] **Step 1: Write failing tests**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenShareGrid } from './ScreenShareGrid';
import type { ShareInfo } from '../../hooks/useScreenShare';

const makeShare = (userId: number, name: string): ShareInfo => ({
  roomName: 'channel-1',
  userName: name,
  userId,
});

const makeVideoMap = (userIds: number[]) => {
  const map = new Map<number, HTMLVideoElement>();
  for (const id of userIds) {
    map.set(id, document.createElement('video'));
  }
  return map;
};

describe('ScreenShareGrid', () => {
  it('renders single layout for 1 stream', () => {
    const shares = [makeShare(1, 'Alice')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="single"]')).toBeTruthy();
  });

  it('renders grid-2 layout for 2 streams', () => {
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="grid-2"]')).toBeTruthy();
  });

  it('renders grid-4 layout for 4 streams', () => {
    const shares = [makeShare(1, 'A'), makeShare(2, 'B'), makeShare(3, 'C'), makeShare(4, 'D')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2, 3, 4])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="grid-4"]')).toBeTruthy();
  });

  it('renders focused layout when focusedShare is set', () => {
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob'), makeShare(3, 'Charlie')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2, 3])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="focused-3"]')).toBeTruthy();
  });

  it('calls onFocus with share when tile is clicked in grid mode', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[0]);
    expect(onFocus).toHaveBeenCalledWith(shares[0]);
  });

  it('calls onFocus(null) when focused tile is clicked again', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    // Click the focused tile (first one)
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[0]);
    expect(onFocus).toHaveBeenCalledWith(null);
  });

  it('calls onFocus with new share when thumbnail is clicked in focused mode', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    // Click the thumbnail (second tile)
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[1]);
    expect(onFocus).toHaveBeenCalledWith(shares[1]);
  });

  it('renders nothing when watchingShares is empty', () => {
    const { container } = render(
      <ScreenShareGrid
        watchingShares={[]}
        focusedShare={null}
        videoElements={new Map()}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.screen-share-grid')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/Brmble.Web && npx vitest run src/components/ScreenShareGrid/ScreenShareGrid.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScreenShareGrid`**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.tsx`:

```tsx
import { useEffect, useCallback } from 'react';
import { ScreenShareTile } from './ScreenShareTile';
import type { ShareInfo } from '../../hooks/useScreenShare';
import './ScreenShareGrid.css';

interface ScreenShareGridProps {
  watchingShares: ShareInfo[];
  focusedShare: ShareInfo | null;
  videoElements: Map<number, HTMLVideoElement>;
  onFocus: (share: ShareInfo | null) => void;
  onClose: (share: ShareInfo) => void;
}

function getLayout(count: number, hasFocus: boolean): string {
  if (count === 0) return 'none';
  if (count === 1) return 'single';
  if (hasFocus) return `focused-${count}`;
  return `grid-${count}`;
}

export function ScreenShareGrid({ watchingShares, focusedShare, videoElements, onFocus, onClose }: ScreenShareGridProps) {
  // Esc key clears focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedShare) {
        onFocus(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedShare, onFocus]);

  const handleTileClick = useCallback((share: ShareInfo) => {
    if (watchingShares.length === 1) return; // single view, no focus toggle
    if (focusedShare?.userId === share.userId) {
      onFocus(null); // unfocus
    } else {
      onFocus(share); // focus this tile
    }
  }, [watchingShares.length, focusedShare, onFocus]);

  if (watchingShares.length === 0) return null;

  const layout = getLayout(watchingShares.length, focusedShare !== null);

  // In focused mode, render focused tile first, then thumbnails
  const orderedShares = focusedShare
    ? [focusedShare, ...watchingShares.filter(s => s.userId !== focusedShare.userId)]
    : watchingShares;

  return (
    <div className="screen-share-grid" data-layout={layout}>
      {focusedShare && (
        <div className="screen-share-grid-primary">
          {(() => {
            const videoEl = videoElements.get(focusedShare.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                videoEl={videoEl}
                sharerName={focusedShare.userName}
                isFocused={true}
                isThumbnail={false}
                onClick={() => handleTileClick(focusedShare)}
                onClose={() => onClose(focusedShare)}
              />
            );
          })()}
        </div>
      )}
      {focusedShare && (
        <div className="screen-share-grid-thumbnails">
          {orderedShares.slice(1).map(share => {
            const videoEl = videoElements.get(share.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                key={share.userId}
                videoEl={videoEl}
                sharerName={share.userName}
                isFocused={false}
                isThumbnail={true}
                onClick={() => handleTileClick(share)}
                onClose={() => onClose(share)}
              />
            );
          })}
        </div>
      )}
      {!focusedShare && (
        <>
          {orderedShares.map(share => {
            const videoEl = videoElements.get(share.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                key={share.userId}
                videoEl={videoEl}
                sharerName={share.userName}
                isFocused={false}
                isThumbnail={false}
                onClick={() => handleTileClick(share)}
                onClose={() => onClose(share)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `ScreenShareGrid.css`**

Create `src/Brmble.Web/src/components/ScreenShareGrid/ScreenShareGrid.css`:

```css
.screen-share-grid {
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 2px;
}

/* Single stream — full area */
.screen-share-grid[data-layout="single"] {
  display: flex;
}

.screen-share-grid[data-layout="single"] .screen-share-tile {
  flex: 1;
}

/* 2 streams — side by side */
.screen-share-grid[data-layout="grid-2"] {
  display: flex;
}

.screen-share-grid[data-layout="grid-2"] .screen-share-tile {
  flex: 1;
}

/* 3 streams — 2 top, 1 bottom full width */
.screen-share-grid[data-layout="grid-3"] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.screen-share-grid[data-layout="grid-3"] .screen-share-tile:nth-child(3) {
  grid-column: 1 / -1;
}

/* 4 streams — 2x2 grid */
.screen-share-grid[data-layout="grid-4"] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

/* Focused layouts — primary left, thumbnails stacked right */
.screen-share-grid[data-layout^="focused-"] {
  display: flex;
}

.screen-share-grid-primary {
  flex: 3;
  display: flex;
  min-width: 0;
}

.screen-share-grid-primary .screen-share-tile {
  flex: 1;
}

.screen-share-grid-thumbnails {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
}

.screen-share-grid-thumbnails .screen-share-tile {
  flex: 1;
}
```

- [ ] **Step 5: Create barrel export**

Create `src/Brmble.Web/src/components/ScreenShareGrid/index.ts`:

```typescript
export { ScreenShareGrid } from './ScreenShareGrid';
export { ScreenShareTile } from './ScreenShareTile';
```

- [ ] **Step 6: Run tests**

Run: `cd src/Brmble.Web && npx vitest run src/components/ScreenShareGrid/`
Expected: All tests PASS (both ScreenShareTile and ScreenShareGrid).

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/ScreenShareGrid/
git commit -m "feat: add ScreenShareGrid component with grid and focused layouts"
```

---

### Task 5: Integrate `ScreenShareGrid` into `ChatPanel`

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`

Replace the single `ScreenShareViewer` usage in `ChatPanel` with the new `ScreenShareGrid`.

- [ ] **Step 1: Update `ChatPanel` props**

In `ChatPanel.tsx`, replace the screen share props:

```typescript
// Remove these props:
//   screenShareVideoEl?: HTMLVideoElement | null;
//   screenSharerName?: string;
//   onCloseScreenShare?: () => void;

// Add these props:
  watchingShares?: ShareInfo[];
  focusedShare?: ShareInfo | null;
  remoteVideoEls?: Map<number, HTMLVideoElement>;
  onFocusShare?: (share: ShareInfo | null) => void;
  onCloseShare?: (share: ShareInfo) => void;
  screenShareViewerMode?: 'in-app' | 'new-window';
```

Add the import:

```typescript
import { ScreenShareGrid } from '../ScreenShareGrid';
import type { ShareInfo } from '../../hooks/useScreenShare';
```

- [ ] **Step 2: Replace `ScreenShareViewer` rendering with `ScreenShareGrid`**

Replace the `hasScreenShare` logic and the `ScreenShareViewer` JSX block. The `hasScreenShare` check becomes:

```typescript
const hasScreenShare = screenShareViewerMode === 'in-app' && (watchingShares?.length ?? 0) > 0 && remoteVideoEls && remoteVideoEls.size > 0 && onCloseShare;
```

Replace the `ScreenShareViewer` JSX:

```tsx
{hasScreenShare && (
  <>
    <div className="chat-split-video" style={{ flex: `0 0 ${splitPercent}%` }}>
      <ScreenShareGrid
        watchingShares={watchingShares!}
        focusedShare={focusedShare ?? null}
        videoElements={remoteVideoEls!}
        onFocus={onFocusShare ?? (() => {})}
        onClose={onCloseShare!}
      />
    </div>
    <div
      className="chat-split-divider"
      role="separator"
      /* ... rest of divider unchanged ... */
    />
  </>
)}
```

Remove the `ScreenShareViewer` import.

- [ ] **Step 3: Update `App.tsx` to pass new props**

In `App.tsx`, update the `ChatPanel` usage. Replace the old screen share props:

```tsx
// Old:
screenShareVideoEl={remoteVideoEl}
screenSharerName={watchingShare?.userName ?? activeShare?.userName}
onCloseScreenShare={disconnectViewer}

// New:
watchingShares={watchingShares}
focusedShare={focusedShare}
remoteVideoEls={remoteVideoEls}
onFocusShare={setFocusedShare}
onCloseShare={(share) => disconnectViewer(share.userId)}
```

Destructure the new fields from `useScreenShare`:

```typescript
const { isSharing, startSharing, stopSharing, error: screenShareError, activeShare, activeShares, watchingShare, watchingShares, focusedShare, setFocusedShare, remoteVideoEl, remoteVideoEls, disconnectViewer, connectAsViewer } = useScreenShare(() => {
```

- [ ] **Step 4: Update `handleWatchScreenShare` for toggle behavior**

The existing `handleWatchScreenShare` in `App.tsx` calls `connectAsViewer`. Since `connectAsViewer` now has toggle behavior built in, this function should work as-is. Verify it still passes the correct arguments.

- [ ] **Step 5: Handle the new-window viewer mode**

The `hasNewWindowScreenShare` logic in `ChatPanel` needs to work with the first watched stream (backward compat). Update:

```typescript
const hasNewWindowScreenShare = screenShareViewerMode === 'new-window' && (watchingShares?.length ?? 0) > 0 && remoteVideoEls && remoteVideoEls.size > 0 && onCloseShare;
```

Update the new-window effect to use the first entry from `remoteVideoEls` and `watchingShares`:

```typescript
const firstShare = watchingShares?.[0];
const firstVideoEl = firstShare ? remoteVideoEls?.get(firstShare.userId) : undefined;
```

- [ ] **Step 6: Build and verify no TypeScript errors**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No type errors related to our changes (pre-existing errors may appear).

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: integrate ScreenShareGrid into ChatPanel replacing ScreenShareViewer"
```

---

### Task 6: Sidebar monitor icon toggle and watching indicator

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

Make the monitor icon a click-to-toggle (start/stop watching) and visually indicate which streams are being watched.

- [ ] **Step 1: Update `ChannelTree` props**

Add `watchingShares` to the props (it currently only receives `watchingShare` singular). The component needs the full array to check if each user is being watched:

```typescript
// In the ChannelTreeProps interface, add:
watchingShares?: ShareInfo[];
```

- [ ] **Step 2: Make monitor icon clickable as toggle**

Currently the monitor icon is just a visual indicator. Wrap it in a button-like click handler. Find the monitor icon rendering (around line 340-341) and replace it:

```tsx
<span className="user-status-area">
  {(activeShares?.some(s => s.sessionId === user.session) || user.session === sharingUserSession) ? (
    <button
      className="user-status-icon-btn"
      onClick={(e) => {
        e.stopPropagation();
        const share = activeShares?.find(s => s.sessionId === user.session);
        if (share) {
          onWatchScreenShare?.(`channel-${channel.id}`, share.userId, share.matrixUserId);
        }
      }}
      title={watchingShares?.some(s => s.sessionId === user.session) ? 'Stop watching' : 'Watch screen'}
    >
      <Icon
        name="monitor"
        size={11}
        className={`user-status-icon user-status-icon--sharing${watchingShares?.some(s => s.sessionId === user.session) ? ' user-status-icon--watching' : ''}`}
        stroke="var(--accent-primary)"
        strokeWidth={2.5}
      />
    </button>
  ) : (
    /* ... existing muted/deafened icons unchanged ... */
  )}
</span>
```

- [ ] **Step 3: Add CSS for the toggle button and watching state**

In the Sidebar CSS file (find where `.user-status-icon--watching` or `.user-status-icon--sharing` is defined), add:

```css
.user-status-icon-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.user-status-icon--watching {
  filter: drop-shadow(0 0 3px var(--accent-primary));
}
```

- [ ] **Step 4: Pass `watchingShares` from `App.tsx` through `Sidebar` to `ChannelTree`**

In `App.tsx`, add `watchingShares={watchingShares}` to the `Sidebar` component props. Thread it through `Sidebar.tsx` to `ChannelTree`.

- [ ] **Step 5: Remove the double-click-to-watch behavior**

The `onDoubleClick` handler on user list items (line 332-337) currently triggers `onWatchScreenShare`. Since the monitor icon is now the toggle, remove the `onDoubleClick` for screen sharing (or keep it as a convenience — decide based on testing). Recommended: keep it for discoverability but have it call the same toggle.

- [ ] **Step 6: Build and verify**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: sidebar monitor icon toggle for start/stop watching"
```

---

### Task 7: Clean up — retire `ScreenShareViewer`

**Files:**
- Delete: `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx`
- Delete: `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` (remove old import if still present)

- [ ] **Step 1: Verify no remaining imports of `ScreenShareViewer`**

Search for any remaining references:

Run: `cd src/Brmble.Web && grep -r "ScreenShareViewer" src/`
Expected: No results (or only in test files that should also be removed).

- [ ] **Step 2: Delete the old component files**

```bash
git rm src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx
git rm src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.css
```

If the directory has no other files, remove it:
```bash
git rm -r src/Brmble.Web/src/components/ScreenShareViewer/
```

- [ ] **Step 3: Remove backward-compat shims from `useScreenShare` if no longer needed**

Check if anything still uses `watchingShare` (singular) or `remoteVideoEl` (singular). If not, remove the backward-compat lines from the hook. If `App.tsx` still uses them for notifications or other purposes, keep them for now.

- [ ] **Step 4: Build and run all tests**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Run: `cd src/Brmble.Web && npx vitest run`
Expected: All pass (the pre-existing `replyHelpers` failure may appear — unrelated).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove ScreenShareViewer, fully replaced by ScreenShareGrid"
```

---

### Task 8: Update roadmap and spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`
- Modify: `docs/superpowers/specs/2026-04-20-multi-share-layouts-design.md`

- [ ] **Step 1: Add A2 to the roadmap table**

In the roadmap file, add a row for A2 after A:

```markdown
| A2 | Multi-Share Layouts | Designed | `2026-04-20-multi-share-layouts-design.md` |
```

Update the suggested build order to include A2 after A.

- [ ] **Step 2: Mark A2 items in sub-project A as "moved to A2"**

In the roadmap's "A. Multi-Share Foundation" section, update items 3, 4, 6:

```markdown
3. ~~Grid/mosaic view~~ → moved to A2
4. ~~Primary + thumbnail layout~~ → moved to A2
6. ~~Share pinning~~ → deferred (not in A2 scope)
```

- [ ] **Step 3: Mark A2 spec as implemented**

Update the status line in the A2 spec:

```markdown
**Status:** Implemented
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/
git commit -m "docs: update roadmap and specs for A2 multi-share layouts"
```

---

### Task 9: Final integration test and manual verification

- [ ] **Step 1: Run full frontend test suite**

Run: `cd src/Brmble.Web && npx vitest run`
Expected: All new tests pass. Pre-existing `replyHelpers` failure is unrelated.

- [ ] **Step 2: Run TypeScript check**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new errors from our changes.

- [ ] **Step 3: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Manual testing checklist**

Test with two clients (A and B) locally:

- A shares, B clicks monitor icon → single viewer (same as today)
- A shares, C shares, B clicks both monitor icons → 2-stream grid
- B clicks one tile → focused mode (large + thumbnail)
- B clicks focused tile → back to grid
- B presses Esc → back to grid
- B clicks monitor icon again → stops watching that stream, grid adjusts
- A stops sharing → B's grid loses that tile, reflows
- B switches channels → all views cleared

- [ ] **Step 5: Commit any fixes from manual testing**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

(Skip this step if no fixes were needed.)
