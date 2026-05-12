import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';
import bridge from '../bridge';

const roomEventHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
const localTrackEventHandlers = new Map<string, Set<() => void>>();
let localSharePublicationEnabled = false;
let mockRoomConstructionCount = 0;
const mockRoomInstances: Array<{ connect: ReturnType<typeof vi.fn> }> = [];

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
  for (const handler of [...(roomEventHandlers.get(event) ?? [])]) {
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
    connect = vi.fn((...args: unknown[]) => mockRoom.connect(...args));
    disconnect = vi.fn((...args: unknown[]) => mockRoom.disconnect(...args));
    name = mockRoom.name;
    get state() { return mockRoom.state; }
    localParticipant = mockRoom.localParticipant;
    remoteParticipants = mockRoom.remoteParticipants;
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      mockRoom.on(event, handler);
      return this;
    });

    constructor() {
      mockRoomConstructionCount += 1;
      mockRoomInstances.push(this);
    }
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

const liveKitToken = (token: string, url = 'ws://localhost/livekit') => {
  const calls = (bridge.send as ReturnType<typeof vi.fn>).mock.calls;
  const requestTokenCall = [...calls].reverse().find(([type]) => type === 'livekit.requestToken');
  const requestId = (requestTokenCall?.[1] as { requestId?: number } | undefined)?.requestId;
  return { token, url, requestId };
};

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoom.state = undefined;
    roomEventHandlers.clear();
    localTrackEventHandlers.clear();
    localSharePublicationEnabled = false;
    mockRoomConstructionCount = 0;
    mockRoomInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
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
      tokenHandler?.(liveKitToken('test-jwt'));
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'publish', requestId: 1 });
    expect(result.current.isSharing).toBe(true);
  });

  it('stopSharing cancels a pending share start before token resolution', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    const sharePromise = result.current.startSharing('channel-1');
    await act(async () => {
      await result.current.stopSharing();
      tokenHandler?.(liveKitToken('test-jwt'));
      await sharePromise;
    });

    expect(mockRoom.connect).not.toHaveBeenCalled();
    expect(mockRoom.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(result.current.isSharing).toBe(false);
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStarted')).toHaveLength(0);
  });

  it('stopSharing cancels a pending share start after room connect before capture publishes', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let resolveCapture: (() => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });
    mockRoom.localParticipant.setScreenShareEnabled.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveCapture = resolve;
    }));

    const { result } = renderHook(() => useScreenShare());

    const sharePromise = result.current.startSharing('channel-1');
    await act(async () => {
      tokenHandler?.(liveKitToken('test-jwt'));
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.stopSharing();
      resolveCapture?.();
      await sharePromise;
    });

    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, undefined);
    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(result.current.isSharing).toBe(false);
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStarted')).toHaveLength(0);
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
      tokenHandler?.(liveKitToken('jwt'));
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 1 });
  });

  it('accepts token expiry metadata when connecting as viewer', async () => {
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
      tokenHandler?.({
        token: 'jwt',
        url: 'ws://localhost/livekit',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        requestId: 1,
      });
      await promise;
    });

    expect(mockRoom.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'jwt');
  });

  it('refreshes token before expiry and keeps the room connected on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 2 });

    await act(async () => {
      tokenHandlers[1]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:20:00.000Z', requestId: 2 });
      await Promise.resolve();
    });

    expect(mockRoom.disconnect).not.toHaveBeenCalled();
    expect(result.current.watchingShares).toHaveLength(1);
  });

  it('uses a fresh room and refreshed viewer token to recover a disconnected room without clearing watch state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    await act(async () => {
      tokenHandlers[1]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:20:00.000Z', requestId: 2 });
      await Promise.resolve();
    });

    await act(async () => {
      mockRoom.state = 'disconnected';
      emitRoomEvent('disconnected');
      await Promise.resolve();
    });

    expect(mockRoomConstructionCount).toBe(2);
    expect(mockRoomInstances[0]?.connect).toHaveBeenCalledTimes(1);
    expect(mockRoomInstances[0]?.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'viewer-jwt');
    expect(mockRoomInstances[1]?.connect).toHaveBeenCalledTimes(1);
    expect(mockRoomInstances[1]?.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'viewer-jwt-2');
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ roomName: 'channel-1', userId: 10 })]);
  });

  it('does not recover a disconnected publisher with a fresh empty room', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
    });

    const onDisconnected = vi.fn();
    const onLocalShareEnded = vi.fn();
    const { result } = renderHook(() => (useScreenShare as any)(onDisconnected, undefined, onLocalShareEnded));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandlers[0]?.({ token: 'publisher-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    await act(async () => {
      tokenHandlers[1]?.({ token: 'publisher-jwt-2', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:20:00.000Z', requestId: 2 });
      await Promise.resolve();
    });

    await act(async () => {
      mockRoom.state = 'disconnected';
      emitRoomEvent('disconnected');
      await Promise.resolve();
    });

    expect(mockRoomConstructionCount).toBe(1);
    expect(mockRoomInstances[0]?.connect).toHaveBeenCalledTimes(1);
    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledTimes(1);
    expect(onLocalShareEnded).toHaveBeenCalledWith('interrupted');
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  });

  it('disconnects and clears watching state when token refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    const tokenErrorHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.tokenError') tokenErrorHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
      tokenErrorHandlers[1]?.({ error: 'forbidden', requestId: 2 });
      await Promise.resolve();
    });

    expect(mockRoom.disconnect).toHaveBeenCalled();
    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.error).toBe('LiveKit access could not be renewed');
  });

  it('cancels pending token refresh when viewer disconnects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await result.current.disconnectViewer();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    const tokenRequests = (bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.requestToken');
    expect(tokenRequests).toHaveLength(1);
  });

  it('ignores stale in-flight refresh failure after reconnecting to the same room', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    const tokenErrorHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.tokenError') tokenErrorHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });
    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 2 });

    act(() => {
      emitRoomEvent('disconnected');
    });
    expect(result.current.watchingShares).toEqual([]);

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[2]?.({ token: 'viewer-jwt-3', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:20:00.000Z', requestId: 3 });
      await promise;
    });

    expect(result.current.watchingShares).toHaveLength(1);
    const disconnectCallsAfterReconnect = mockRoom.disconnect.mock.calls.length;

    await act(async () => {
      tokenErrorHandlers[1]?.({ error: 'forbidden', requestId: 2 });
      await Promise.resolve();
    });

    expect(result.current.watchingShares).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(mockRoom.disconnect).toHaveBeenCalledTimes(disconnectCallsAfterReconnect);
  });

  it('suppresses a second startSharing call while one is already connecting', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    const firstPromise = result.current.startSharing('channel-1');
    const secondPromise = result.current.startSharing('channel-1');

    await act(async () => {
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit', expiresAt: new Date(Date.now() + 3600_000).toISOString(), requestId: 1 });
      await Promise.all([firstPromise, secondPromise]);
    });

    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.requestToken')).toHaveLength(1);
    expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStarted')).toHaveLength(1);
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
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await promise;
    });

    expect(result.current.watchingShares).toHaveLength(1);
    expect(result.current.watchingShares[0].userId).toBe(10);

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      tokenHandler?.(liveKitToken('publisher-jwt'));
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
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await viewerPromise;
    });

    await act(async () => {
      const sharePromise = result.current.startSharing('channel-1');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      tokenHandler?.(liveKitToken('publisher-jwt'));
      await sharePromise;
    });

    act(() => {
      emitRoomEvent('disconnected');
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
    expect(result.current.isSharing).toBe(false);
  });

  it('upgrade token failure clears stale upgrade state and watched shares', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    const tokenErrorHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.tokenError') tokenErrorHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await viewerPromise;
    });

    await act(async () => {
      const sharePromise = result.current.startSharing('channel-1');
      emitRoomEvent('disconnected');
      await Promise.resolve();
      tokenErrorHandlers[1]?.({ error: 'token failed', requestId: 2 });
      await sharePromise;
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
    expect(result.current.remoteVideoEls.size).toBe(0);

    let resolveConnect: (() => void) | null = null;
    mockRoom.connect.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveConnect = () => {
        mockRoom.state = 'connected';
        resolve();
      };
    }));

    let viewerPromise: Promise<void> | null = null;
    await act(async () => {
      viewerPromise = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandlers[2]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', requestId: 3 });
      await Promise.resolve();
    });

    act(() => {
      emitRoomEvent('disconnected');
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
    expect(result.current.isSharing).toBe(false);

    await act(async () => {
      resolveConnect?.();
      await viewerPromise;
    });
  });

  it('share stops while viewer connect is pending does not add stale watched share', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    let viewerPromise: Promise<void> | null = null;
    act(() => {
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    });

    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });

    await act(async () => {
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await viewerPromise;
    });

    expect(result.current.activeShares).toEqual([]);
    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.remoteVideoEls.size).toBe(0);
    expect(mockRoom.connect).not.toHaveBeenCalled();
    expect(mockRoom.disconnect).not.toHaveBeenCalled();
  });

  it('clears viewer error after a later successful connectAsViewer', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    const tokenErrorHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.tokenError') tokenErrorHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    await act(async () => {
      const failedViewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenErrorHandlers[0]?.({ error: 'viewer failed', requestId: 1 });
      await expect(failedViewerPromise).rejects.toThrow('viewer failed');
    });

    expect(result.current.error).toBe('viewer failed');

    await act(async () => {
      const viewerPromise = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandlers[1]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', requestId: 2 });
      await viewerPromise;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);
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

  it('clears activeShares when discovery target is cleared', () => {
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
      result.current.setDiscoveryTarget(null);
    });

    expect(result.current.activeShares).toEqual([]);
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

  it('ignores stale same-target activeShareResult with an older requestId', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ scope: 'all', requestId: 1 });
      result.current.setDiscoveryTarget({ scope: 'all', requestId: 2 });
      activeShareHandler?.({
        scope: 'all',
        requestId: 2,
        shares: [{ roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 }],
      });
      activeShareHandler?.({ scope: 'all', requestId: 1, shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
    ]);
  });

  it('ignores activeShareResult when a realtime event after discovery request started a share', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1', requestId: 1 });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
      activeShareHandler?.({ roomName: 'channel-1', requestId: 1, shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
    ]);
  });

  it('ignores activeShareResult when a realtime event after discovery request stopped a share', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());
    const alice = { roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 };

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1', requestId: 1 });
      activeShareHandler?.({ roomName: 'channel-1', requestId: 1, shares: [alice] });
      result.current.setDiscoveryTarget({ roomName: 'channel-1', requestId: 2 });
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
      activeShareHandler?.({ roomName: 'channel-1', requestId: 2, shares: [alice] });
    });

    expect(result.current.activeShares).toEqual([]);
  });

  it('applies room-scoped activeShareResult when an unrelated realtime event happens after discovery request', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ scope: 'all', requestId: 0 });
      activeShareHandler?.({
        scope: 'all',
        requestId: 0,
        shares: [{ roomName: 'channel-2', userId: 10, userName: 'alice', sessionId: 1 }],
      });
      result.current.setDiscoveryTarget({ roomName: 'channel-2', requestId: 1 });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, sessionId: 2 });
      activeShareHandler?.({ roomName: 'channel-2', requestId: 1, shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 20 }),
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

  it('ignores mismatched room shares in room-scoped activeShareResult', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [{ roomName: 'channel-2', userId: 20, userName: 'bob' }],
      });
    });

    expect(result.current.activeShares).toEqual([]);
  });

  it('keeps activeShares unchanged for room-scoped activeShareResult without top-level roomName', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      result.current.setDiscoveryTarget({ roomName: 'channel-1' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
      activeShareHandler?.({ shares: [] });
    });

    expect(result.current.activeShares).toEqual([
      expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
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
      tokenHandler?.(liveKitToken('jwt'));
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

  it('removes watched share when its screen-share track unsubscribes', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      attach: vi.fn(() => document.createElement('video')),
      detach: vi.fn(),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('jwt'));
      await p;
    });

    act(() => {
      result.current.setFocusedShare(result.current.watchingShares[0]);
      emitRoomEvent('trackSubscribed', screenShareTrack, {}, { identity: '@alice:test' });
    });

    expect(result.current.watchingShares).toHaveLength(1);
    expect(result.current.focusedShare?.userId).toBe(10);
    expect(result.current.remoteVideoEls.has(10)).toBe(true);

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    expect(screenShareTrack.detach).toHaveBeenCalledTimes(1);
    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.focusedShare).toBeNull();
    expect(result.current.remoteVideoEls.has(10)).toBe(false);
    expect(mockRoom.disconnect).toHaveBeenCalledTimes(1);
  });

  it('preserves supplied matrixUserId for unsubscribe matching when active share lacks identity', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('jwt'));
      await p;
    });

    expect(result.current.watchingShares[0].matrixUserId).toBe('@alice:test');

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    expect(screenShareTrack.detach).toHaveBeenCalledTimes(1);
    expect(result.current.watchingShares).toEqual([]);
  });

  it('multiple watched shares keep the room connected when one track unsubscribes', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

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
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('jwt'));
      await p;
    });
    await act(async () => {
      await result.current.connectAsViewer('channel-1', 20, '@bob:test');
    });
    mockRoom.disconnect.mockClear();

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);
    expect(mockRoom.disconnect).not.toHaveBeenCalled();
  });

  it('multiple watched shares unsubscribed in the same tick disconnect after the last cleanup', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const aliceTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };
    const bobTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

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
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('jwt'));
      await p;
    });
    await act(async () => {
      await result.current.connectAsViewer('channel-1', 20, '@bob:test');
    });
    mockRoom.disconnect.mockClear();

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', aliceTrack, {}, { identity: '@alice:test' });
      emitRoomEvent('trackUnsubscribed', bobTrack, {}, { identity: '@bob:test' });
      await Promise.resolve();
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.disconnect).toHaveBeenCalledTimes(1);
  });

  it('local sharing keeps the room connected when a remote track unsubscribes', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const p = result.current.startSharing('channel-1');
      tokenHandler?.(liveKitToken('publisher-jwt'));
      await p;
    });
    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });
    await act(async () => {
      await result.current.connectAsViewer('channel-1', 10, '@alice:test');
    });
    mockRoom.disconnect.mockClear();

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    expect(result.current.isSharing).toBe(true);
    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.disconnect).not.toHaveBeenCalled();
  });

  it('stale disconnected events from an old room do not clear a newer watch state', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

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
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('alice-jwt'));
      await p;
    });

    const oldDisconnectedHandler = Array.from(roomEventHandlers.get('disconnected') ?? [])[0];

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandler?.(liveKitToken('bob-jwt'));
      await p;
    });

    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);

    act(() => {
      oldDisconnectedHandler?.();
    });

    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);
  });

  it('stale track unsubscribed events from an old room do not clear a newer watch state', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

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
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('alice-jwt'));
      await p;
    });

    const oldTrackUnsubscribedHandler = Array.from(roomEventHandlers.get('trackUnsubscribed') ?? [])[0];

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandler?.(liveKitToken('bob-jwt'));
      await p;
    });
    mockRoom.disconnect.mockClear();

    await act(async () => {
      oldTrackUnsubscribedHandler?.(screenShareTrack, {}, { identity: '@bob:test' });
      await Promise.resolve();
    });

    expect(screenShareTrack.detach).toHaveBeenCalledTimes(1);
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);
    expect(mockRoom.disconnect).not.toHaveBeenCalled();
  });

  it('stale track subscribed events from an old room do not attach to a newer watch state', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      attach: vi.fn(() => document.createElement('video')),
      detach: vi.fn(),
    };

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
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('alice-jwt'));
      await p;
    });

    const oldTrackSubscribedHandler = Array.from(roomEventHandlers.get('trackSubscribed') ?? [])[0];

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandler?.(liveKitToken('bob-jwt'));
      await p;
    });

    act(() => {
      oldTrackSubscribedHandler?.(screenShareTrack, {}, { identity: '@bob:test' });
    });

    expect(screenShareTrack.attach).not.toHaveBeenCalled();
    expect(result.current.remoteVideoEls.has(20)).toBe(false);
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 20 })]);
  });

  it('track unsubscribe during replacement does not remove preserved watch state', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let resolveDisconnect: (() => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      detach: vi.fn(),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await p;
    });

    mockRoom.disconnect.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveDisconnect = resolve;
    }));

    let startPromise: Promise<boolean> | null = null;
    act(() => {
      startPromise = result.current.startSharing('channel-1');
    });

    await act(async () => {
      emitRoomEvent('trackUnsubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      await Promise.resolve();
    });

    expect(screenShareTrack.detach).not.toHaveBeenCalled();
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 10 })]);

    await act(async () => {
      resolveDisconnect?.();
      await Promise.resolve();
      tokenHandler?.(liveKitToken('publisher-jwt'));
      await startPromise;
    });

    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 10 })]);
    expect(result.current.isSharing).toBe(true);
  });

  it('pending viewer connect resolving after disconnectViewer does not add stale watch state', async () => {
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

    let viewerPromise: Promise<void> | null = null;
    act(() => {
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    });

    await act(async () => {
      await result.current.disconnectViewer();
    });

    await act(async () => {
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await viewerPromise;
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('pending viewer connect clears pending state after disconnectViewer without waiting for token', async () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    let viewerPromise: Promise<void> | null = null;
    const onSettled = vi.fn();
    act(() => {
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      viewerPromise.then(onSettled, onSettled);
    });

    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      await result.current.disconnectViewer();
      await Promise.resolve();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.isViewerConnectPending).toBe(false);
    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('full disconnect cancels pending viewer connect when room is already connected', async () => {
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
      const alicePromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await alicePromise;
    });

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    let bobPromise: Promise<void> | null = null;
    act(() => {
      bobPromise = result.current.connectAsViewer('channel-1', 20, '@bob:test');
    });

    await act(async () => {
      await result.current.disconnectViewer();
      await bobPromise;
    });

    expect(result.current.watchingShares).toEqual([]);
  });

  it('unmount cancels pending viewer connect without waiting for token', async () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result, unmount } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    const onSettled = vi.fn();
    act(() => {
      result.current.connectAsViewer('channel-1', 10, '@alice:test').then(onSettled, onSettled);
    });

    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('share stops while pending viewer connect cancels without waiting for token', async () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    const onSettled = vi.fn();
    act(() => {
      result.current.connectAsViewer('channel-1', 10, '@alice:test').then(onSettled, onSettled);
    });

    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
      await Promise.resolve();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.isViewerConnectPending).toBe(false);
    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('targeted pending viewer disconnect cancels without adding stale watch after token', async () => {
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

    const onSettled = vi.fn();
    act(() => {
      result.current.connectAsViewer('channel-1', 10, '@alice:test').then(onSettled, onSettled);
    });

    await act(async () => {
      await result.current.disconnectViewer(10);
      await Promise.resolve();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.isViewerConnectPending).toBe(false);

    await act(async () => {
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await Promise.resolve();
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('token listener cleanup runs when pending viewer is canceled on unmount', async () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result, unmount } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      result.current.connectAsViewer('channel-1', 10, '@alice:test').catch(() => {});
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(bridge.off).toHaveBeenCalledWith('livekit.token', expect.any(Function));
    expect(bridge.off).toHaveBeenCalledWith('livekit.tokenError', expect.any(Function));
  });

  it('multiple pending viewer connects keep active target pending when another target stops', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    const aliceSettled = vi.fn();
    const bobSettled = vi.fn();
    let alicePromise: Promise<void> | null = null;
    let bobPromise: Promise<void> | null = null;
    act(() => {
      alicePromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      bobPromise = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      alicePromise.then(aliceSettled, aliceSettled);
      bobPromise.then(bobSettled, bobSettled);
    });

    await act(async () => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 20 });
      await Promise.resolve();
    });

    expect(bobSettled).toHaveBeenCalledTimes(1);
    expect(aliceSettled).not.toHaveBeenCalled();
    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await alicePromise;
      await bobPromise;
    });

    expect(result.current.isViewerConnectPending).toBe(false);
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 10 })]);
    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  });

  it('first pending target stops after another target registers and settles promptly', async () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    const aliceSettled = vi.fn();
    const bobSettled = vi.fn();
    act(() => {
      result.current.connectAsViewer('channel-1', 10, '@alice:test').then(aliceSettled, aliceSettled);
      result.current.connectAsViewer('channel-1', 20, '@bob:test').then(bobSettled, bobSettled);
    });

    await act(async () => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
      await Promise.resolve();
    });

    expect(aliceSettled).toHaveBeenCalledTimes(1);
    expect(bobSettled).not.toHaveBeenCalled();
    expect(result.current.isViewerConnectPending).toBe(true);
    expect(mockRoom.connect).not.toHaveBeenCalled();
  });

  it('superseded viewer connect settles and clears its pending attempt', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-2', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    let firstViewerPromise: Promise<void> | null = null;
    let secondViewerPromise: Promise<void> | null = null;
    act(() => {
      firstViewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      secondViewerPromise = result.current.connectAsViewer('channel-2', 20, '@bob:test');
    });

    await act(async () => {
      await firstViewerPromise;
    });

    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      tokenHandlers[1]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', requestId: 2 });
      await secondViewerPromise;
    });

    expect(result.current.isViewerConnectPending).toBe(false);
  });

  it('superseded viewer connect finishing keeps newer viewer pending state', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-2', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    let firstViewerPromise: Promise<void> | null = null;
    let secondViewerPromise: Promise<void> | null = null;
    act(() => {
      firstViewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      secondViewerPromise = result.current.connectAsViewer('channel-2', 20, '@bob:test');
    });

    await act(async () => {
      await firstViewerPromise;
    });

    expect(result.current.isViewerConnectPending).toBe(true);

    await act(async () => {
      tokenHandlers[1]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', requestId: 2 });
      await secondViewerPromise;
    });

    expect(result.current.isViewerConnectPending).toBe(false);
  });

  it('parallel viewer connects share one room creation', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, matrixUserId: '@bob:test' });
    });

    await act(async () => {
      const alicePromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      const bobPromise = result.current.connectAsViewer('channel-1', 20, '@bob:test');
      tokenHandlers[0]?.(liveKitToken('viewer-jwt'));
      tokenHandlers[1]?.(liveKitToken('viewer-jwt-2'));
      await Promise.all([alicePromise, bobPromise]);
    });

    expect(mockRoomConstructionCount).toBe(1);
    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
    expect(result.current.watchingShares).toEqual([
      expect.objectContaining({ userId: 10 }),
      expect.objectContaining({ userId: 20 }),
    ]);
  });

  it('track subscribed during connect attaches preserved watched share video', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let resolveDisconnect: (() => void) | null = null;
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      attach: vi.fn(() => document.createElement('video')),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });
    mockRoom.connect.mockImplementationOnce(async () => { mockRoom.state = 'connected'; });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.(liveKitToken('viewer-jwt'));
      await p;
    });

    mockRoom.disconnect.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveDisconnect = resolve;
    }));
    mockRoom.connect.mockImplementationOnce(async () => {
      emitRoomEvent('trackSubscribed', screenShareTrack, {}, { identity: '@alice:test' });
      mockRoom.state = 'connected';
    });

    await act(async () => {
      const p = result.current.startSharing('channel-1');
      resolveDisconnect?.();
      await Promise.resolve();
      tokenHandler?.(liveKitToken('publisher-jwt'));
      await p;
    });

    expect(screenShareTrack.attach).toHaveBeenCalledTimes(1);
    expect(result.current.remoteVideoEls.has(10)).toBe(true);
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 10 })]);
  });

  it('incompatible pending subscribe is superseded by publish without consuming publish token', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    let viewerPromise: Promise<void> | null = null;
    let sharePromise: Promise<boolean> | null = null;
    act(() => {
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      sharePromise = result.current.startSharing('channel-1');
    });

    await act(async () => {
      tokenHandlers[0]?.({ token: 'subscribe-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      tokenHandlers[1]?.({ token: 'publish-jwt', url: 'ws://localhost/livekit', requestId: 2 });
      await Promise.all([viewerPromise, sharePromise]);
    });

    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
    expect(mockRoom.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'publish-jwt');
    expect(result.current.isSharing).toBe(true);
    expect(result.current.watchingShares).toEqual([]);
  });

  it('stale token responses are ignored for the current room request', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    let viewerPromise: Promise<void> | null = null;
    let sharePromise: Promise<boolean> | null = null;
    act(() => {
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      sharePromise = result.current.startSharing('channel-1');
    });

    await act(async () => {
      tokenHandlers[1]?.({ token: 'subscribe-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await Promise.resolve();
    });

    expect(mockRoom.connect).not.toHaveBeenCalled();

    await act(async () => {
      tokenHandlers[1]?.({ token: 'publish-jwt', url: 'ws://localhost/livekit', requestId: 2 });
      await Promise.all([viewerPromise, sharePromise]);
    });

    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
    expect(mockRoom.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'publish-jwt');
    expect(result.current.isSharing).toBe(true);
  });

  it('missing requestId token response is ignored when requestId was sent', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    let sharePromise: Promise<boolean> | null = null;
    act(() => {
      sharePromise = result.current.startSharing('channel-1');
    });

    await act(async () => {
      tokenHandler?.({ token: 'legacy-jwt', url: 'ws://localhost/livekit' });
      await Promise.resolve();
    });

    expect(mockRoom.connect).not.toHaveBeenCalled();

    await act(async () => {
      tokenHandler?.({ token: 'publish-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await sharePromise;
    });

    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
    expect(mockRoom.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'publish-jwt');
    expect(result.current.isSharing).toBe(true);
  });

  it('publish followed by subscribe reuses pending publish request', async () => {
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    let sharePromise: Promise<boolean> | null = null;
    let viewerPromise: Promise<void> | null = null;
    act(() => {
      sharePromise = result.current.startSharing('channel-1');
      viewerPromise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    });

    await act(async () => {
      tokenHandlers[0]?.({ token: 'publish-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await Promise.all([sharePromise, viewerPromise]);
    });

    expect(mockRoom.connect).toHaveBeenCalledTimes(1);
    expect(mockRoom.connect).toHaveBeenCalledWith('ws://localhost/livekit', 'publish-jwt');
    expect(result.current.isSharing).toBe(true);
    expect(result.current.watchingShares).toEqual([expect.objectContaining({ userId: 10 })]);
  });

  it('connect failure clears failed room so stale events do not mutate watch state', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    const connectError = new Error('connect failed');
    const screenShareTrack = {
      kind: 'video',
      source: 'screen_share',
      attach: vi.fn(() => document.createElement('video')),
    };

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });
    mockRoom.connect.mockRejectedValueOnce(connectError);

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandler?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', requestId: 1 });
      await expect(p).rejects.toThrow('connect failed');
    });

    act(() => {
      emitRoomEvent('trackSubscribed', screenShareTrack, {}, { identity: '@alice:test' });
    });

    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.remoteVideoEls.has(10)).toBe(false);
    expect(screenShareTrack.attach).not.toHaveBeenCalled();
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
        if (uid === 10) tokenHandler?.(liveKitToken('jwt'));
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
      tokenHandler?.(liveKitToken('jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
      await promise;
    });

    await act(async () => {
      await result.current.stopSharing();
    });

    mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.(liveKitToken('test-jwt'));
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
      tokenHandler?.(liveKitToken('test-jwt'));
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
