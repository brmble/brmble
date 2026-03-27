# Watch Screen Feature Design

## Overview

Add "Watch Screen" option to user context menus (right-click) to view another user's screen share when they're using LiveKit. Supports multiple simultaneous viewers (each screen share opens in its own popup).

## User Experience

### Context Menu
- "Watch Screen" appears in user context menu only when the user is actively sharing their screen
- Clicking "Watch Screen" opens a popup window with the shared screen
- Multiple users can be watched simultaneously by opening multiple popups

### Popup Behavior
- Each popup is an independent `ScreenShareViewer` instance
- Popups can be positioned and resized by the user
- Each popup manages its own LiveKit viewer connection
- Closing a popup disconnects from that specific screen share

## Architecture

### New Components

#### ScreenShareContext.tsx
A React context that tracks all active screen shares across the application.

```typescript
interface ActiveShare {
  roomName: string;
  userName: string;
  sessionId: number;
}

interface ScreenShareContextValue {
  activeShares: Map<number, ActiveShare>;  // keyed by sessionId
  isUserSharing: (sessionId: number) => boolean;
  getShareForUser: (sessionId: number) => ActiveShare | undefined;
}
```

**Data flow:**
1. Bridge receives `livekit.screenShareStarted` → update Map with sessionId
2. Bridge receives `livekit.screenShareStopped` → remove sessionId from Map
3. Context menu queries context to determine if user is sharing

### Modified Components

#### useScreenShare.ts
- Remove local `activeShare` state
- Use `ScreenShareContext` to read active shares
- `connectAsViewer(roomName)` remains unchanged (per-popup connections)
- Keep `disconnectViewer()` for cleanup

#### ChannelTree.tsx
- Add "Watch Screen" menu item in user context menu (around line 485)
- Condition: only show if `isUserSharing(parseInt(contextMenu.userId))`
- On click: add popup state for that user

#### Sidebar.tsx
- Same pattern as ChannelTree for root channel user context menu

#### ScreenShareViewer.tsx
- Add popup title showing sharer's name
- Position in center of viewport initially
- Allow drag to reposition

## Data Flow

```
┌─────────────┐     livekit.          ┌───────────────────┐
│   Bridge    │────screenShareStarted─▶│ ScreenShareContext│
│  (C# <-> JS)│     screenShareStopped │  activeShares Map │
└─────────────┘                        └─────────┬─────────┘
                                                │
                           isUserSharing()      │
                              getShareForUser()  │
                                       │        │
                              ┌────────▼────────▼──────┐
                              │     ContextMenu       │
                              │  (Watch Screen item)  │
                              └───────────┬───────────┘
                                          │ onClick
                          ┌──────────────▼──────────────┐
                          │    ScreenShareViewer        │
                          │  (per-popup instance)      │
                          │    connectAsViewer()        │
                          └─────────────────────────────┘
```

## Implementation Details

### 1. ScreenShareContext

```typescript
// src/Brmble.Web/src/contexts/ScreenShareContext.tsx
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import bridge from '../bridge';

export interface ActiveShare {
  roomName: string;
  userName: string;
  sessionId: number;
}

interface ScreenShareContextValue {
  activeShares: Map<number, ActiveShare>;
  isUserSharing: (sessionId: number) => boolean;
  getShareForUser: (sessionId: number) => ActiveShare | undefined;
}

const ScreenShareContext = createContext<ScreenShareContextValue | null>(null);

export function ScreenShareProvider({ children }: { children: ReactNode }) {
  const [activeShares, setActiveShares] = useState<Map<number, ActiveShare>>(new Map());

  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const { roomName, userName, sessionId } = data as ActiveShare;
      setActiveShares(prev => new Map(prev).set(sessionId, { roomName, userName, sessionId }));
    };

    const onShareStopped = (data: unknown) => {
      const { roomName } = data as { roomName: string };
      setActiveShares(prev => {
        const next = new Map(prev);
        for (const [id, share] of next) {
          if (share.roomName === roomName) {
            next.delete(id);
            break;
          }
        }
        return next;
      });
    };

    bridge.on('livekit.screenShareStarted', onShareStarted);
    bridge.on('livekit.screenShareStopped', onShareStopped);

    return () => {
      bridge.off('livekit.screenShareStarted', onShareStarted);
      bridge.off('livekit.screenShareStopped', onShareStopped);
    };
  }, []);

  const value: ScreenShareContextValue = {
    activeShares,
    isUserSharing: (sessionId) => activeShares.has(sessionId),
    getShareForUser: (sessionId) => activeShares.get(sessionId),
  };

  return (
    <ScreenShareContext.Provider value={value}>
      {children}
    </ScreenShareContext.Provider>
  );
}

export function useScreenShareContext() {
  const context = useContext(ScreenShareContext);
  if (!context) throw new Error('useScreenShareContext must be used within ScreenShareProvider');
  return context;
}
```

### 2. Context Menu Integration

```typescript
// In ChannelTree.tsx - user context menu items
import { useScreenShareContext } from '../contexts/ScreenShareContext';

// Inside component:
const { isUserSharing, getShareForUser } = useScreenShareContext();
const userSessionId = parseInt(contextMenu.userId);

// Add to menu items array (after Local Mute, before Admin):
...(isUserSharing(userSessionId) ? [{
  type: 'item' as const,
  label: 'Watch Screen',
  icon: <ScreenIcon />,
  onClick: () => {
    const share = getShareForUser(userSessionId);
    if (share) {
      openScreenSharePopup(share);
    }
  },
}] : []),
```

### 3. Popup State Management

```typescript
// In ChannelTree.tsx or parent component
interface ScreenSharePopup {
  id: string;
  sessionId: number;
  userName: string;
}

const [screenSharePopups, setScreenSharePopups] = useState<ScreenSharePopup[]>([]);

const openScreenSharePopup = (share: ActiveShare) => {
  const id = `${share.sessionId}-${Date.now()}`;
  setScreenSharePopups(prev => [...prev, {
    id,
    sessionId: share.sessionId,
    userName: share.userName,
  }]);
};

const closeScreenSharePopup = (id: string) => {
  setScreenSharePopups(prev => prev.filter(p => p.id !== id));
};

// Render popups:
{screenSharePopups.map(popup => (
  <ScreenShareViewer
    key={popup.id}
    roomName={/* get from activeShares */ popup.sessionId}
    userName={popup.userName}
    onClose={() => closeScreenSharePopup(popup.id)}
  />
))}
```

### 4. ScreenShareViewer Enhancements

```typescript
interface ScreenShareViewerProps {
  roomName: string;  // LiveKit room name
  userName: string;   // Sharer's name for title
  onClose: () => void;
}

// Add title bar with sharer name and close button
<div className="screen-share-viewer">
  <div className="viewer-header">
    <span>{userName}'s Screen</span>
    <button onClick={onClose}>×</button>
  </div>
  <div className="viewer-content">
    {/* existing video element */}
  </div>
</div>
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/Brmble.Web/src/contexts/ScreenShareContext.tsx` | Create |
| `src/Brmble.Web/src/hooks/useScreenShare.ts` | Modify - use context |
| `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` | Modify - add menu item |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` | Modify - add menu item |
| `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx` | Modify - add title props |
| `src/Brmble.Web/src/App.tsx` | Modify - wrap with ScreenShareProvider |

## Testing Considerations

1. **Unit tests:**
   - `ScreenShareContext` updates Map correctly on start/stop events
   - `isUserSharing()` returns correct boolean
   - Context menu conditionally renders based on sharing status

2. **Integration tests:**
   - User shares screen → context menu shows "Watch Screen"
   - Click "Watch Screen" → popup opens with video
   - Close popup → viewer disconnects
   - Multiple popups → all work independently

3. **Manual testing:**
   - Right-click user not sharing → no "Watch Screen" option
   - Right-click user sharing → "Watch Screen" appears
   - Watch user A, then user B → two popups, both showing
   - User stops sharing → popup shows "stream ended" or closes
