import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMatrixClient } from './useMatrixClient';
import type { MatrixCredentials } from './useMatrixClient';

// --- mock matrix-js-sdk ---
const mockClient = {
  startClient: vi.fn(),
  stopClient: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  getRoom: vi.fn(),
  scrollback: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({}),
  createRoom: vi.fn(),
  getAccountData: vi.fn(),
  setAccountData: vi.fn(),
};

vi.mock('matrix-js-sdk', () => ({
  createClient: vi.fn(() => mockClient),
  RoomEvent: { Timeline: 'Room.timeline' },
  ClientEvent: { Sync: 'Sync', AccountData: 'AccountData' },
  EventType: { RoomMessage: 'm.room.message', Direct: 'm.direct' },
  MsgType: { Text: 'm.text' },
  Preset: { TrustedPrivateChat: 'trusted_private_chat' },
}));

const creds: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_abc',
  userId: '@1:example.com',
  roomMap: { '42': '!room:example.com' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMatrixClient', () => {
  it('calls startClient when credentials are provided', () => {
    renderHook(() => useMatrixClient(creds));
    expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 20 });
  });

  it('does not call startClient when credentials are null', () => {
    renderHook(() => useMatrixClient(null));
    expect(mockClient.startClient).not.toHaveBeenCalled();
  });

  it('calls stopClient on unmount', () => {
    const { unmount } = renderHook(() => useMatrixClient(creds));
    unmount();
    expect(mockClient.stopClient).toHaveBeenCalled();
  });

  it('calls stopClient and clears messages when credentials become null', () => {
    const { result, rerender } = renderHook(
      ({ c }: { c: MatrixCredentials | null }) => useMatrixClient(c),
      { initialProps: { c: creds as MatrixCredentials | null } }
    );
    act(() => rerender({ c: null }));
    expect(mockClient.stopClient).toHaveBeenCalled();
    expect(result.current.messages.size).toBe(0);
  });

  it('registers RoomEvent.Timeline listener', () => {
    renderHook(() => useMatrixClient(creds));
    expect(mockClient.on).toHaveBeenCalledWith('Room.timeline', expect.any(Function));
  });

  it('sendMessage posts to correct Matrix room', async () => {
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.sendMessage('42', 'hello'));
    expect(mockClient.sendMessage).toHaveBeenCalledWith('!room:example.com', {
      msgtype: 'm.text',
      body: 'hello',
    });
  });

  it('sendMessage does nothing when channelId has no room mapping', async () => {
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.sendMessage('999', 'hello'));
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it('fetchHistory calls scrollback on the room', async () => {
    const mockRoom = { roomId: '!room:example.com' };
    mockClient.getRoom.mockReturnValue(mockRoom);
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.fetchHistory('42'));
    expect(mockClient.scrollback).toHaveBeenCalledWith(mockRoom, 50);
  });

  it('timeline handler uses member display name as sender', () => {
    const { result } = renderHook(() => useMatrixClient(creds));

    // Extract the registered timeline handler
    const onCall = mockClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'Room.timeline'
    );
    expect(onCall).toBeDefined();
    const handler = onCall![1] as (event: unknown, room: unknown) => void;

    const mockEvent = {
      getType: () => 'm.room.message',
      getSender: () => '@1:example.com',
      getId: () => 'evt1',
      getContent: () => ({ body: 'hello' }),
      getTs: () => Date.now(),
    };
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: (userId: string) =>
        userId === '@1:example.com'
          ? { name: 'Alice', rawDisplayName: 'Alice' }
          : null,
    };

    act(() => handler(mockEvent, mockRoom));
    const msgs = result.current.messages.get('42');
    expect(msgs).toHaveLength(1);
    expect(msgs![0].sender).toBe('Alice');
  });

  it('timeline handler falls back to senderId when member has no display name', () => {
    const { result } = renderHook(() => useMatrixClient(creds));

    const onCall = mockClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'Room.timeline'
    );
    const handler = onCall![1] as (event: unknown, room: unknown) => void;

    const mockEvent = {
      getType: () => 'm.room.message',
      getSender: () => '@99:example.com',
      getId: () => 'evt2',
      getContent: () => ({ body: 'hi' }),
      getTs: () => Date.now(),
    };
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => null,
    };

    act(() => handler(mockEvent, mockRoom));
    const msgs = result.current.messages.get('42');
    expect(msgs).toBeDefined();
    const last = msgs![msgs!.length - 1];
    expect(last.sender).toBe('@99:example.com');
  });

  it('does not create duplicate rooms for concurrent DM sends', async () => {
    mockClient.createRoom.mockResolvedValue({ room_id: '!dm:example.com' });
    mockClient.getAccountData.mockReturnValue({ getContent: () => ({}) });
    mockClient.setAccountData.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMatrixClient(creds));

    // Send two DMs concurrently to the same user
    await act(async () => {
      await Promise.all([
        result.current.sendDMMessage('@bob:example.com', 'hello'),
        result.current.sendDMMessage('@bob:example.com', 'world'),
      ]);
    });

    // Only one room should be created
    expect(mockClient.createRoom).toHaveBeenCalledTimes(1);
    // Both messages should be sent
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);
  });
});
