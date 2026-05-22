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
    const room = {
      roomId: '!room:example.com',
      getLiveTimeline: () => ({
        getEvents: () => [
          makeMessageEvent('$m1', 1000, 'one'),
          makeReplacementEvent('$r1', 2000, '$m1'),
          makeMessageEvent('$m2', 3000, 'two'),
        ],
      }),
      getUnreadNotificationCount: () => 0,
      getAccountData: () => null,
      findEventById: () => null,
    };
    mockClient.getRooms.mockReturnValue([room]);
    mockClient.getRoom.mockReturnValue(room);

    const { result } = renderHook(() =>
      useUnreadTracker(mockClient as never, new Set<string>(), null, 'Me', 'fp1'),
    );

    await act(async () => {
      await result.current.markRoomRead('!room:example.com', '$m1');
    });

    const unread = result.current.getRoomUnread('!room:example.com');
    expect(unread.notificationCount).toBe(1);
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
      useUnreadTracker(mockClient as never, new Set<string>(), '!room:example.com', 'Me', 'fp1'),
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
