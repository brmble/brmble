import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';
import bridge from '../bridge';

// Mock livekit-client
const mockRoom = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  localParticipant: {
    setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
  },
  on: vi.fn().mockReturnThis(),
};

vi.mock('livekit-client', () => ({
  Room: class MockRoom {
    connect = mockRoom.connect;
    disconnect = mockRoom.disconnect;
    localParticipant = mockRoom.localParticipant;
    on = mockRoom.on;
  },
  RoomEvent: { Disconnected: 'disconnected' },
}));

// Mock bridge
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

  it('starts in idle state', () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('requests token via bridge and connects on startSharing', async () => {
    // When bridge.on is called, capture the handlers
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('room-1');
      // Simulate bridge response
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'room-1' });
    expect(result.current.isSharing).toBe(true);
  });

  it('sets error on token error from bridge', async () => {
    let errorHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.tokenError') errorHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('room-1');
      errorHandler?.({ error: 'No client certificate' });
      await promise;
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('invokes onDisconnected callback on RoomEvent.Disconnected', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    // Capture the Disconnected event handler registered on the Room
    let disconnectedHandler: (() => void) | null = null;
    mockRoom.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'disconnected') disconnectedHandler = handler;
      return mockRoom;
    });

    const onDisconnected = vi.fn();
    const { result } = renderHook(() => useScreenShare(onDisconnected));

    // Start sharing to create a room with the event handler
    await act(async () => {
      const promise = result.current.startSharing('room-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(result.current.isSharing).toBe(true);
    expect(disconnectedHandler).not.toBeNull();

    // Simulate LiveKit disconnect event
    await act(async () => {
      disconnectedHandler?.();
    });

    expect(result.current.isSharing).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('disconnects on stopSharing', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('room-1');
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
      const promise = result.current.startSharing('room-1');
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

  it('does not include systemAudio when captureAudio is false', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const settings = {
      captureAudio: false,
      systemAudio: true,
      resolution: '1080p' as const,
      fps: 30 as const,
    };

    const { result } = renderHook(() => useScreenShare(undefined, settings));

    await act(async () => {
      const promise = result.current.startSharing('room-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    const [[, options]] = mockRoom.localParticipant.setScreenShareEnabled.mock.calls;
    expect(options.systemAudio).toBeUndefined();
    expect('audio' in options).toBe(false);
  });
});
