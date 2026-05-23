import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnreadTracker, resetMarkersCache } from './useUnreadTracker';

const mockClient = {
  on: vi.fn(),
  off: vi.fn(),
  getRooms: vi.fn(),
  getRoom: vi.fn(),
  getSyncState: vi.fn(() => 'PREPARED'),
  getUserId: vi.fn(() => '@me:example.com'),
  setRoomReadMarkersHttpRequest: vi.fn().mockResolvedValue(undefined),
};

// Stable empty dm-room set. useUnreadTracker keys several useCallback/useEffect
// dependency arrays on this Set by reference (App passes a useMemo'd value), so
// recreating it inline on every render would retrigger the effect → setState →
// render loop and exhaust the worker heap. Share one reference across renders.
const NO_DM_ROOMS = new Set<string>();

function makeMessageEvent(id: string, ts: number, body: string, sender = '@alice:example.com') {
  return {
    getId: () => id,
    getType: () => 'm.room.message',
    getTs: () => ts,
    getSender: () => sender,
    getContent: () => ({ body }),
  };
}

function makeReplacementEvent(id: string, ts: number, targetId: string, sender = '@alice:example.com') {
  return {
    getId: () => id,
    getType: () => 'm.room.message',
    getTs: () => ts,
    getSender: () => sender,
    getContent: () => ({
      body: '* edited',
      msgtype: 'm.text',
      'm.new_content': { body: 'edited', msgtype: 'm.text' },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
    }),
  };
}

describe('useUnreadTracker replacement filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetMarkersCache();
  });

  it('does not count replacement events as unread', async () => {
    // markRoomRead anchors the stored marker ts to max(Date.now(), markedEventTs)
    // as clock-skew protection, and countUnreadFromTimeline only counts events
    // strictly newer than that marker ts. Freeze the clock so the unread events
    // ($r1/$m2, after "now") stay newer than the marker regardless of how slow
    // the run is — otherwise a slow CI run advances Date.now() past them.
    vi.useFakeTimers();
    try {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);
      const events = [
        makeMessageEvent('$m1', now - 3000, 'one'),
        makeReplacementEvent('$r1', now + 1000, '$m1'),
        makeMessageEvent('$m2', now + 2000, 'two'),
      ];
      const room = {
        roomId: '!room:example.com',
        getLiveTimeline: () => ({ getEvents: () => events }),
        getUnreadNotificationCount: () => 0,
        getAccountData: () => null,
        findEventById: (id: string) => events.find((e) => e.getId() === id) ?? null,
      };
      mockClient.getRooms.mockReturnValue([room]);
      mockClient.getRoom.mockReturnValue(room);

      const { result } = renderHook(() =>
        useUnreadTracker(mockClient as never, NO_DM_ROOMS, null, 'Me', 'fp1'),
      );

      await act(async () => {
        await result.current.markRoomRead('!room:example.com', '$m1');
      });

      // markRoomRead stores the read marker but optimistically shows 0 unread;
      // the count is recomputed from the marker on the next Room.timeline event.
      // Fire that handler so buildRoomUnread runs with the marker in place.
      const onTimeline = mockClient.on.mock.calls
        .filter((call) => call[0] === 'Room.timeline')
        .map((call) => call[1] as (event: unknown, room: unknown) => void)
        .at(-1)!;
      act(() => {
        onTimeline(null, room);
      });

      const unread = result.current.getRoomUnread('!room:example.com');
      expect(unread.notificationCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-mark active room read for replacement events', () => {
    const room = {
      roomId: '!room:example.com',
      getLiveTimeline: () => ({ getEvents: () => [] }),
      getUnreadNotificationCount: () => 0,
      getAccountData: () => null,
      findEventById: () => null,
    };
    mockClient.getRooms.mockReturnValue([room]);
    mockClient.getRoom.mockReturnValue(room);

    renderHook(() =>
      useUnreadTracker(mockClient as never, NO_DM_ROOMS, '!room:example.com', 'Me', 'fp1'),
    );

    const timelineHandlers = mockClient.on.mock.calls
      .filter((call) => call[0] === 'Room.timeline')
      .map((call) => call[1] as (event: unknown, room: unknown) => void);

    expect(timelineHandlers.length).toBeGreaterThan(0);
    const replacement = makeReplacementEvent('$r1', 2000, '$m1');
    act(() => {
      timelineHandlers[timelineHandlers.length - 1](replacement, room);
    });

    expect(mockClient.setRoomReadMarkersHttpRequest).not.toHaveBeenCalled();
  });
});
