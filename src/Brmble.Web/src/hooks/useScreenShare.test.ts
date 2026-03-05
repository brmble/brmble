import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';

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

// Mock fetch for token requests
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches token and connects on startSharing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'test-jwt', url: 'ws://localhost/livekit' }),
    });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });

    expect(mockFetch).toHaveBeenCalledWith('/livekit/token', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ roomName: 'room-1' }),
    }));
    expect(result.current.isSharing).toBe(true);
  });

  it('sets error on token fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('disconnects on stopSharing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'test-jwt', url: 'ws://localhost/livekit' }),
    });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });
    await act(async () => {
      await result.current.stopSharing();
    });

    expect(result.current.isSharing).toBe(false);
  });
});
