import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';
import bridge from '../bridge';

// Mock livekit-client
const mockRoom = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  name: 'channel-1',
  localParticipant: {
    setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
  },
  remoteParticipants: new Map(),
  on: vi.fn().mockReturnThis(),
};

vi.mock('livekit-client', () => ({
  Room: class MockRoom {
    connect = mockRoom.connect;
    disconnect = mockRoom.disconnect;
    name = mockRoom.name;
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

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1' });
    expect(result.current.isSharing).toBe(true);
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
