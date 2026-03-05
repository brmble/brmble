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
});
