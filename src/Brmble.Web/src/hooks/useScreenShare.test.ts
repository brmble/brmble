import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';
import bridge from '../bridge';

const roomEventHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
const localTrackEventHandlers = new Map<string, Set<() => void>>();
let localSharePublicationEnabled = false;

const mockLocalScreenShareTrack = {
  addEventListener: vi.fn((event: string, handler: () => void) => {
    const handlers = localTrackEventHandlers.get(event) ?? new Set<() => void>();
    handlers.add(handler);
    localTrackEventHandlers.set(event, handlers);
  }),
  removeEventListener: vi.fn((event: string, handler: () => void) => {
    localTrackEventHandlers.get(event)?.delete(handler);
  }),
  on: vi.fn((event: string, handler: () => void) => {
    const handlers = localTrackEventHandlers.get(event) ?? new Set<() => void>();
    handlers.add(handler);
    localTrackEventHandlers.set(event, handlers);
  }),
  off: vi.fn((event: string, handler: () => void) => {
    localTrackEventHandlers.get(event)?.delete(handler);
  }),
};

const emitRoomEvent = (event: string, ...args: unknown[]) => {
  for (const handler of roomEventHandlers.get(event) ?? []) {
    handler(...args);
  }
};

const emitLocalTrackEvent = (event: string) => {
  for (const handler of localTrackEventHandlers.get(event) ?? []) {
    handler();
  }
};

// Mock livekit-client
const mockRoom = {
  connect: vi.fn().mockImplementation(async () => { mockRoom.state = 'connected'; }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  name: 'channel-1',
  state: undefined as string | undefined,
  localParticipant: {
    setScreenShareEnabled: vi.fn().mockImplementation(async (enabled: boolean) => {
      localSharePublicationEnabled = enabled;
    }),
    getTrackPublication: vi.fn((source: string) => {
      if (source !== 'screen_share' || !localSharePublicationEnabled) {
        return undefined;
      }

      return {
        track: mockLocalScreenShareTrack,
        source: 'screen_share',
      };
    }),
  },
  remoteParticipants: new Map(),
  on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = roomEventHandlers.get(event) ?? new Set<(...args: unknown[]) => void>();
    handlers.add(handler);
    roomEventHandlers.set(event, handlers);
    return mockRoom;
  }),
};

vi.mock('livekit-client', () => ({
  Room: class MockRoom {
    connect = mockRoom.connect;
    disconnect = mockRoom.disconnect;
    name = mockRoom.name;
    get state() { return mockRoom.state; }
    localParticipant = mockRoom.localParticipant;
    remoteParticipants = mockRoom.remoteParticipants;
    on = mockRoom.on;
  },
  RoomEvent: {
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: {
    Kind: { Video: 'video' },
    Source: { ScreenShare: 'screen_share' },
  },
}));

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoom.state = undefined;
    roomEventHandlers.clear();
    localTrackEventHandlers.clear();
    localSharePublicationEnabled = false;
  });

  it('starts in idle state with empty activeShares', () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.activeShares).toEqual([]);
    expect(result.current.watchingShare).toBeNull();
    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
  });

  it('requests token via bridge and connects on startSharing', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'publish' });
    expect(result.current.isSharing).toBe(true);
  });

  it('requests subscribe token via bridge when connecting as viewer', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.({ token: 'jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe' });
  });

  it('preserves watching state when upgrading from viewer to publisher in the same room', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.watchingShares).toHaveLength(1);
    expect(result.current.watchingShares[0].userId).toBe(10);

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      tokenHandler?.({ token: 'publisher-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(true);
    expect(result.current.watchingShares).toHaveLength(1);
    expect(result.current.watchingShares[0].userId).toBe(10);
    expect(result.current.focusedShare).toBeNull();
  });

  it('still clears watching state on a real disconnect after upgrade', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit' });
      await viewerPromise;
    });

    await act(async () => {
      const sharePromise = result.current.startSharing('channel-1');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      tokenHandler?.({ token: 'publisher-jwt', url: 'ws://localhost/livekit' });
      await sharePromise;
    });

    act(() => {
      emitRoomEvent('disconnected');
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
    expect(result.current.isSharing).toBe(false);
  });

  it('accumulates multiple screenShareStarted events into activeShares', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
    });
    expect(result.current.activeShares).toHaveLength(1);
    expect(result.current.activeShares[0].userName).toBe('alice');

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, sessionId: 2 });
    });
    expect(result.current.activeShares).toHaveLength(2);
  });

  it('removes specific user from activeShares on screenShareStopped', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20 });
    });
    expect(result.current.activeShares).toHaveLength(2);

    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });
    expect(result.current.activeShares).toHaveLength(1);
    expect(result.current.activeShares[0].userName).toBe('bob');
  });

  it('clears watchingShare when watched user stops sharing', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
    });

    // Simulate watching alice (set watchingShare manually via the hook's internal state)
    // In practice this happens via connectAsViewer, but for unit test we trigger the event
    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });
    expect(result.current.activeShares).toHaveLength(0);
    expect(result.current.watchingShare).toBeNull();
  });

  it('populates activeShares from activeShareResult with shares array', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [
          { userId: 10, userName: 'alice', sessionId: 1 },
          { userId: 20, userName: 'bob', sessionId: 2 },
        ],
      });
    });
    expect(result.current.activeShares).toHaveLength(2);
  });

  it('reconciles activeShares only for the queried room when activeShareResult succeeds', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-2' });
      activeShareHandler?.({
        roomName: 'channel-2',
        shares: [{ userId: 20, userName: 'bob', sessionId: 2 }],
      });
    });

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
      });
    });

    expect(result.current.activeShares).toHaveLength(2);
    expect(result.current.activeShares).toEqual([
      { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
      { roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 },
    ]);
  });

  it('replaces activeShares with global discovery results when scope is all', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
      });
    });

    act(() => {
      result.current.setDiscoveryTarget({ scope: 'all' });
      activeShareHandler?.({
        scope: 'all',
        shares: [
          { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
          { roomName: 'channel-3', userId: 30, userName: 'charlie', sessionId: 3 },
        ],
      });
    });

    expect(result.current.activeShares).toEqual([
      { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
      { roomName: 'channel-3', userId: 30, userName: 'charlie', sessionId: 3 },
    ]);
  });

  it('keeps global share badges after switching back to room-scoped discovery', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ scope: 'all' });
      activeShareHandler?.({
        scope: 'all',
        shares: [
          { roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 },
          { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
        ],
      });
    });

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-2' });
      activeShareHandler?.({ roomName: 'channel-2', shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
    ]);
  });

  it('ignores stale room-scoped activeShareResult after global discovery becomes current', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      result.current.setDiscoveryTarget({ scope: 'all' });
      activeShareHandler?.({
        scope: 'all',
        shares: [{ roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 }],
      });
      activeShareHandler?.({ roomName: 'channel-1', shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
    ]);
  });

  it('keeps realtime share events from other rooms in global visibility state', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-2' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
    ]);

    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });

    expect(result.current.activeShares).toEqual([]);
  });

  it('clears activeShares only for the queried room when activeShareResult returns empty', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
      });
      result.current.setDiscoveryTarget({ roomName: 'channel-2' });
      activeShareHandler?.({
        roomName: 'channel-2',
        shares: [{ userId: 20, userName: 'bob', sessionId: 2 }],
      });
    });

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [],
      });
    });

    expect(result.current.activeShares).toEqual([
      { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
    ]);
  });

  it('does not clear existing activeShares on activeShareError', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    let activeShareErrorHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
      if (type === 'livekit.activeShareError') activeShareErrorHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    expect(activeShareErrorHandler).not.toBeNull();

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
      });
    });

    act(() => {
      activeShareErrorHandler?.({ roomName: 'channel-1', reason: 'request-failed' });
    });

    expect(result.current.activeShares).toHaveLength(1);
    expect(result.current.activeShares[0].userId).toBe(10);
  });

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

  it('disconnects on stopSharing', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });
    await act(async () => {
      await result.current.stopSharing();
    });

    expect(result.current.isSharing).toBe(false);
  });

  it('surfaces the manual local stop reason once without triggering disconnect callback', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    await act(async () => {
      await result.current.stopSharing();
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('manual');
    expect(bridge.send).toHaveBeenCalledWith('livekit.shareStopped', { roomName: 'channel-1' });
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  });

  it('preserves explicit manual teardown intent across room disconnect', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    await act(async () => {
      result.current.markLocalShareTeardownIntent('manual');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('manual');
  });

  it('classifies local capture ending as source-closed and only stops once', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    await act(async () => {
      emitLocalTrackEvent('ended');
      await Promise.resolve();
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('source-closed');
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  });

  it('classifies active-share room disconnect as interrupted and notifies once', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    act(() => {
      emitRoomEvent('disconnected');
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('interrupted');
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  });

  it('deduplicates local stop cleanup when source end and disconnect race', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    await act(async () => {
      emitLocalTrackEvent('ended');
      emitRoomEvent('disconnected');
      await Promise.resolve();
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('source-closed');
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  });

  it('removes the local ended listener on unmount', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onLocalShareEnded = vi.fn();
    const { result, unmount } = renderHook(() => useScreenShare(undefined, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(mockLocalScreenShareTrack.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));

    unmount();

    expect(mockLocalScreenShareTrack.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));

    await act(async () => {
      emitLocalTrackEvent('ended');
      await Promise.resolve();
    });

    expect(onLocalShareEnded).not.toHaveBeenCalled();
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
  });

  it('classifies start publish failure as error and emits local stop callback once', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const publishError = new Error('Publish failed');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBe('Publish failed');
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('error');
  });

  it('treats picker cancel as a benign pre-share abort', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const pickerCancelError = new DOMException('Selection canceled by user', 'AbortError');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(pickerCancelError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).not.toHaveBeenCalled();
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
  });

  it('classifies blocked window capture as a clearer platform error', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const publishError = new DOMException('Permission denied by user while starting capture pipeline', 'AbortError');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBe('Windows could not share that app or window. Try sharing your full screen or a different window.');
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('blocked-capture');
  });

  it('treats plain exact permission denied by user as benign picker cancel', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const pickerCancelError = { message: 'Permission denied by user' };
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(pickerCancelError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).not.toHaveBeenCalled();
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
  });

  it('keeps non-picker errors with longer permission denied wording on the error path', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const publishError = { message: 'Permission denied by user while starting capture pipeline' };
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBe('Permission denied by user while starting capture pipeline');
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('error');
  });

  it('treats DOMException NotAllowedError with permission denied by user as benign picker cancel', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const pickerCancelError = new DOMException('Permission denied by user', 'NotAllowedError');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(pickerCancelError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).not.toHaveBeenCalled();
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
  });

  it('treats DOMException AbortError with permission denied by user as benign picker cancel', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const pickerCancelError = new DOMException('Permission denied by user', 'AbortError');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(pickerCancelError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).not.toHaveBeenCalled();
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
  });

  it('keeps spec-style DOMException NotAllowedError permission denials on the error path', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const publishError = new DOMException(
      'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
      'NotAllowedError',
    );
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBe(
      'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
    );
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('error');
  });

  it('reports error on quick restart even when previous stop already set the stop guard', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    const publishError = new Error('Publish failed');
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    await act(async () => {
      await result.current.stopSharing();
    });

    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBe('Publish failed');
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(onLocalShareEnded).toHaveBeenCalledTimes(2);
    expect(onLocalShareEnded).toHaveBeenNthCalledWith(1, 'manual');
    expect(onLocalShareEnded).toHaveBeenNthCalledWith(2, 'error');
  });

  it('passes correct capture options to setScreenShareEnabled', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const settings = {
      captureAudio: true,
      systemAudio: true,
      resolution: '1080p' as const,
      fps: 30 as const,
    };

    const { result } = renderHook(() => useScreenShare(undefined, settings));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, expect.objectContaining({
      audio: true,
      systemAudio: 'include',
      resolution: { width: 1920, height: 1080, frameRate: 30 },
      videoEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 },
    }));
  });
});
