import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import React from 'react';
import { useMatrixClient } from './useMatrixClient';
import type { MatrixCredentials } from './useMatrixClient';
import { ServiceStatusProvider, useServiceStatus } from './useServiceStatus';

// --- mock bridge ---
vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

// --- mock matrix-js-sdk ---
const mockClient = {
  startClient: vi.fn(),
  stopClient: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  getRoom: vi.fn(),
  getRooms: vi.fn().mockReturnValue([]),
  getAccountData: vi.fn(),
  setAccountData: vi.fn().mockResolvedValue(undefined),
  createRoom: vi.fn().mockResolvedValue({ room_id: '!new:example.com' }),
  scrollback: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({}),
  mxcUrlToHttp: vi.fn((url: string) => url.replace('mxc://', 'https://matrix.example.com/_matrix/media/v3/download/')),
};

vi.mock('matrix-js-sdk', () => ({
  createClient: vi.fn(() => mockClient),
  RoomEvent: { Timeline: 'Room.timeline' },
  ClientEvent: { Sync: 'sync', AccountData: 'accountData' },
  EventType: { RoomMessage: 'm.room.message', Direct: 'm.direct' },
  MsgType: { Text: 'm.text' },
  Preset: { TrustedPrivateChat: 'trusted_private_chat' },
  KnownMembership: { Join: 'join', Invite: 'invite', Leave: 'leave' },
}));

const creds: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_abc',
  userId: '@1:example.com',
  roomMap: { '42': '!room:example.com' },
};

/** Wrapper that provides required context providers */
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ServiceStatusProvider, null, children);
}

function MatrixClientStatusProbe({ credentials }: { credentials: MatrixCredentials }) {
  useMatrixClient(credentials);
  const { statuses } = useServiceStatus();
  return React.createElement('div', { 'data-testid': 'chat-state' }, statuses.chat.state);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMatrixClient', () => {
  it('calls onDirectMessage only for incoming DM messages', () => {
    mockClient.getRoom.mockReturnValue(null);
    const onDirectMessage = vi.fn();
    const credsWithDm: MatrixCredentials = {
      ...creds,
      dmRoomMap: { '@alice:example.com': '!dm:example.com' },
    };
    const callbacks = { onDirectMessage };

    renderHook(() => useMatrixClient(credsWithDm, callbacks), { wrapper });

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    act(() => onSync?.('PREPARED'));

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;

    const incoming = {
      getType: () => 'm.room.message',
      getId: () => '$dm-1',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'ping' }),
      getTs: () => 1_700_000_000_000,
    };
    const outgoing = {
      getType: () => 'm.room.message',
      getId: () => '$dm-2',
      getSender: () => '@1:example.com',
      getContent: () => ({ body: 'pong' }),
      getTs: () => 1_700_000_000_001,
    };
    const dmRoom = {
      roomId: '!dm:example.com',
      getMember: (userId: string) =>
        userId === '@alice:example.com'
          ? { name: 'Alice', rawDisplayName: 'Alice', getAvatarUrl: () => null }
          : null,
    };

    act(() => {
      onTimeline?.(incoming, dmRoom);
      onTimeline?.(outgoing, dmRoom);
    });

    expect(onDirectMessage).toHaveBeenCalledTimes(1);
    expect(onDirectMessage).toHaveBeenCalledWith(
      '@alice:example.com',
      expect.objectContaining({ sender: 'Alice', content: 'ping' }),
    );
  });

  it('calls startClient when credentials are provided', () => {
    renderHook(() => useMatrixClient(creds), { wrapper });
    expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 5 });
  });

  it('does not reconnect when callback object identity changes', () => {
    const { rerender } = renderHook(
      ({ callbacks }: { callbacks: { onDirectMessage: () => void } }) => useMatrixClient(creds, callbacks),
      { initialProps: { callbacks: { onDirectMessage: vi.fn() } }, wrapper },
    );

    expect(mockClient.startClient).toHaveBeenCalledTimes(1);
    expect(mockClient.stopClient).not.toHaveBeenCalled();

    act(() => rerender({ callbacks: { onDirectMessage: vi.fn() } }));

    expect(mockClient.startClient).toHaveBeenCalledTimes(1);
    expect(mockClient.stopClient).not.toHaveBeenCalled();
  });

  it('maps Matrix reconnect sync states to chat status', () => {
    render(
      React.createElement(
        ServiceStatusProvider,
        null,
        React.createElement(MatrixClientStatusProbe, { credentials: creds }),
      ),
    );

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    expect(onSync).toBeDefined();

    act(() => onSync!('RECONNECTING'));
    expect(screen.getByTestId('chat-state').textContent).toBe('connecting');

    act(() => onSync!('PREPARED'));
    expect(screen.getByTestId('chat-state').textContent).toBe('connected');
  });

  it('does not call startClient when credentials are null', () => {
    renderHook(() => useMatrixClient(null), { wrapper });
    expect(mockClient.startClient).not.toHaveBeenCalled();
  });

  it('calls stopClient on unmount', () => {
    const { unmount } = renderHook(() => useMatrixClient(creds), { wrapper });
    unmount();
    expect(mockClient.stopClient).toHaveBeenCalled();
  });

  it('calls stopClient and clears state when credentials become null', () => {
    const { result, rerender } = renderHook(
      ({ c }: { c: MatrixCredentials | null }) => useMatrixClient(c),
      { initialProps: { c: creds as MatrixCredentials | null }, wrapper }
    );
    act(() => rerender({ c: null }));
    expect(mockClient.stopClient).toHaveBeenCalled();
    expect(result.current.lastMessages.size).toBe(0);
    expect(result.current.dmLastMessages.size).toBe(0);
    expect(result.current.activeMessages).toEqual([]);
    expect(result.current.activeDmMessages).toEqual([]);
  });

  it('registers RoomEvent.Timeline listener', () => {
    renderHook(() => useMatrixClient(creds), { wrapper });
    expect(mockClient.on).toHaveBeenCalledWith('Room.timeline', expect.any(Function));
  });

  it('sendMessage posts to correct Matrix room', async () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    await act(() => result.current.sendMessage('42', 'hello'));
    expect(mockClient.sendMessage).toHaveBeenCalledWith('!room:example.com', {
      msgtype: 'm.text',
      body: 'hello',
    });
  });

  it('sendMessage does nothing when channelId has no room mapping', async () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    await act(() => result.current.sendMessage('999', 'hello'));
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it('fetchHistory calls scrollback on the room', async () => {
    const mockRoom = { roomId: '!room:example.com' };
    mockClient.getRoom.mockReturnValue(mockRoom);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    await act(() => result.current.fetchHistory('42'));
    expect(mockClient.scrollback).toHaveBeenCalledWith(mockRoom, 50);
  });

  it('timeline handler uses member display name as sender', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    // Activate channel '42' so timeline events populate activeMessages
    act(() => result.current.setActiveChannel('42'));

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
    expect(result.current.activeMessages).toHaveLength(1);
    expect(result.current.activeMessages[0].sender).toBe('Alice');
  });

  it('exposes the Matrix client instance', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    expect(result.current.client).not.toBeNull();
  });

  it('client is null when credentials are null', () => {
    const { result } = renderHook(() => useMatrixClient(null), { wrapper });
    expect(result.current.client).toBeNull();
  });

  it('timeline handler falls back to senderId when member has no display name', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    // Activate channel '42' so timeline events populate activeMessages
    act(() => result.current.setActiveChannel('42'));

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
    expect(result.current.activeMessages.length).toBeGreaterThanOrEqual(1);
    const last = result.current.activeMessages[result.current.activeMessages.length - 1];
    expect(last.sender).toBe('@99:example.com');
  });

  it('timeline handler extracts sender from bridge prefix when sent by bridge bot', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    // Activate channel '42' so timeline events populate activeMessages
    act(() => result.current.setActiveChannel('42'));

    const onCall = mockClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'Room.timeline'
    );
    const handler = onCall![1] as (event: unknown, room: unknown) => void;

    const mockEvent = {
      getType: () => 'm.room.message',
      getSender: () => '@brmble:example.com',
      getId: () => 'evt-bridge1',
      getContent: () => ({ body: '[Bob]: hello from bridge' }),
      getTs: () => Date.now(),
    };
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: (userId: string) =>
        userId === '@brmble:example.com'
          ? { name: 'Brmble Bridge', rawDisplayName: 'Brmble Bridge' }
          : null,
    };

    act(() => handler(mockEvent, mockRoom));
    expect(result.current.activeMessages.length).toBeGreaterThanOrEqual(1);
    const last = result.current.activeMessages[result.current.activeMessages.length - 1];
    expect(last.sender).toBe('Bob');
    expect(last.content).toBe('hello from bridge');
  });

  it('timeline handler does NOT parse bridge prefix for non-bot senders', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    // Activate channel '42' so timeline events populate activeMessages
    act(() => result.current.setActiveChannel('42'));

    const onCall = mockClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'Room.timeline'
    );
    const handler = onCall![1] as (event: unknown, room: unknown) => void;

    const mockEvent = {
      getType: () => 'm.room.message',
      getSender: () => '@1:example.com',
      getId: () => 'evt-nobridge',
      getContent: () => ({ body: '[Alice]: this is not bridged' }),
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
    expect(result.current.activeMessages.length).toBeGreaterThanOrEqual(1);
    const last = result.current.activeMessages[result.current.activeMessages.length - 1];
    // Sender should be the display name, not parsed from the prefix
    expect(last.sender).toBe('Alice');
    // Content should be the full body, not stripped
    expect(last.content).toBe('[Alice]: this is not bridged');
  });

  it('lastMessages and dmLastMessages start empty', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    expect(result.current.lastMessages.size).toBe(0);
    expect(result.current.dmLastMessages.size).toBe(0);
  });

  it('updates lastMessages when a channel timeline event arrives', () => {
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: vi.fn(() => ({ rawDisplayName: 'Alice', name: 'Alice' })),
    };
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    expect(onTimeline).toBeDefined();

    const fakeEvent = {
      getType: () => 'm.room.message',
      getId: () => '$evt-1',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'hi there' }),
      getTs: () => 1_700_000_000_000,
    };

    act(() => onTimeline!(fakeEvent, mockRoom));

    expect(result.current.lastMessages.get('42')).toEqual({
      content: 'hi there',
      ts: 1_700_000_000_000,
      sender: 'Alice',
    });
  });

  it('setActiveChannel rebuilds activeMessages from SDK timeline', () => {
    const aliceMember = { rawDisplayName: 'Alice', name: 'Alice' };
    const fakeEvents = [
      {
        getType: () => 'm.room.message',
        getId: () => '$e1',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'first' }),
        getTs: () => 1000,
      },
      {
        getType: () => 'm.room.message',
        getId: () => '$e2',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'second' }),
        getTs: () => 2000,
      },
    ];
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => aliceMember,
      getLiveTimeline: () => ({ getEvents: () => fakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockRoom);

    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    act(() => result.current.setActiveChannel('42'));

    expect(result.current.activeMessages).toHaveLength(2);
    expect(result.current.activeMessages[0].content).toBe('first');
    expect(result.current.activeMessages[1].content).toBe('second');
  });

  it('setActiveChannel(null) clears activeMessages', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel(null));
    expect(result.current.activeMessages).toEqual([]);
  });

  it('rapid setActiveChannel switches commit only the latest load', () => {
    const roomA = {
      roomId: '!a:example.com',
      getMember: () => ({ rawDisplayName: 'A', name: 'A' }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$a1', getSender: () => '@a:example.com',
          getContent: () => ({ body: 'A-msg' }), getTs: () => 1 },
      ]}),
    };
    const roomB = {
      roomId: '!b:example.com',
      getMember: () => ({ rawDisplayName: 'B', name: 'B' }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$b1', getSender: () => '@b:example.com',
          getContent: () => ({ body: 'B-msg' }), getTs: () => 1 },
      ]}),
    };
    mockClient.getRoom.mockImplementation((id: string) =>
      id === '!a:example.com' ? roomA : id === '!b:example.com' ? roomB : null);

    const credsAB: MatrixCredentials = {
      ...creds,
      roomMap: { 'A': '!a:example.com', 'B': '!b:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsAB), { wrapper });

    act(() => {
      result.current.setActiveChannel('A');
      result.current.setActiveChannel('B');
      result.current.setActiveChannel('A');
    });

    expect(result.current.activeMessages).toHaveLength(1);
    expect(result.current.activeMessages[0].content).toBe('A-msg');
  });

  it('PREPARED reloads activeMessages when a channel was activated before sync completed', () => {
    // Initially the SDK has no room — setActiveChannel will bail out.
    mockClient.getRoom.mockReturnValue(null);

    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    // Activate before PREPARED — load returns [] because the room is not yet known.
    act(() => result.current.setActiveChannel('42'));
    expect(result.current.activeMessages).toEqual([]);

    // Now simulate the SDK having the room and the timeline populated.
    const aliceMember = { rawDisplayName: 'Alice', name: 'Alice' };
    const fakeEvents = [
      {
        getType: () => 'm.room.message',
        getId: () => '$e-prep-1',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'sync-delivered' }),
        getTs: () => 5000,
      },
    ];
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => aliceMember,
      getLiveTimeline: () => ({ getEvents: () => fakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockRoom);
    mockClient.getRooms.mockReturnValue([mockRoom]);

    // Fire the registered onSync handler with PREPARED.
    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    expect(onSync).toBeDefined();

    act(() => onSync!('PREPARED'));

    expect(result.current.activeMessages).toHaveLength(1);
    expect(result.current.activeMessages[0].content).toBe('sync-delivered');
  });

  // ── DM activeDmMessages + setActiveDmContact ──

  it('setActiveDmContact rebuilds activeDmMessages from SDK timeline', () => {
    mockClient.getRoom.mockReturnValue(null); // reset from PREPARED bootstrap

    const credsWithDm: MatrixCredentials = {
      ...creds,
      dmRoomMap: { '@bob:example.com': '!dm-bob:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsWithDm), { wrapper });

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    act(() => onSync!('PREPARED'));

    const bobMember = { rawDisplayName: 'Bob', name: 'Bob', getAvatarUrl: () => null };
    const dmFakeEvents = [
      { getType: () => 'm.room.message', getId: () => '$dm1', getSender: () => '@bob:example.com',
        getContent: () => ({ body: 'hey' }), getTs: () => 1000 },
      { getType: () => 'm.room.message', getId: () => '$dm2', getSender: () => '@bob:example.com',
        getContent: () => ({ body: 'you there?' }), getTs: () => 2000 },
    ];
    const mockDmRoom = {
      roomId: '!dm-bob:example.com',
      getMember: () => bobMember,
      getLiveTimeline: () => ({ getEvents: () => dmFakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockDmRoom);

    act(() => result.current.setActiveDmContact('@bob:example.com'));

    expect(result.current.activeDmMessages).toHaveLength(2);
    expect(result.current.activeDmMessages[0].content).toBe('hey');
    expect(result.current.activeDmMessages[1].content).toBe('you there?');
  });

  it('setActiveDmContact(null) clears activeDmMessages', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveDmContact(null));
    expect(result.current.activeDmMessages).toEqual([]);
  });

  it('rapid setActiveDmContact switches commit only the latest load', () => {
    mockClient.getRoom.mockReturnValue(null); // reset from bootstrap

    const credsWithDms: MatrixCredentials = {
      ...creds,
      dmRoomMap: {
        '@bob:example.com': '!bob:example.com',
        '@carol:example.com': '!carol:example.com',
      },
    };
    const { result } = renderHook(() => useMatrixClient(credsWithDms), { wrapper });

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    act(() => onSync!('PREPARED'));

    const roomBob = {
      roomId: '!bob:example.com',
      getMember: () => ({ rawDisplayName: 'Bob', name: 'Bob', getAvatarUrl: () => null }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$b1', getSender: () => '@bob:example.com',
          getContent: () => ({ body: 'Bob-msg' }), getTs: () => 1 },
      ]}),
    };
    const roomCarol = {
      roomId: '!carol:example.com',
      getMember: () => ({ rawDisplayName: 'Carol', name: 'Carol', getAvatarUrl: () => null }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$c1', getSender: () => '@carol:example.com',
          getContent: () => ({ body: 'Carol-msg' }), getTs: () => 1 },
      ]}),
    };
    mockClient.getRoom.mockImplementation((id: string) =>
      id === '!bob:example.com' ? roomBob : id === '!carol:example.com' ? roomCarol : null);

    act(() => {
      result.current.setActiveDmContact('@bob:example.com');
      result.current.setActiveDmContact('@carol:example.com');
      result.current.setActiveDmContact('@bob:example.com');
    });

    expect(result.current.activeDmMessages).toHaveLength(1);
    expect(result.current.activeDmMessages[0].content).toBe('Bob-msg');
  });

  it('PREPARED reloads activeDmMessages when a DM was activated before sync completed', () => {
    mockClient.getRoom.mockReturnValue(null);

    const credsWithDm: MatrixCredentials = {
      ...creds,
      dmRoomMap: { '@bob:example.com': '!dm-bob:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsWithDm), { wrapper });

    act(() => result.current.setActiveDmContact('@bob:example.com'));
    expect(result.current.activeDmMessages).toEqual([]);

    const bobMember = { rawDisplayName: 'Bob', name: 'Bob', getAvatarUrl: () => null };
    const dmFakeEvents = [
      { getType: () => 'm.room.message', getId: () => '$dm-prep-1', getSender: () => '@bob:example.com',
        getContent: () => ({ body: 'late arrival' }), getTs: () => 5000 },
    ];
    const mockDmRoom = {
      roomId: '!dm-bob:example.com',
      getMember: () => bobMember,
      getLiveTimeline: () => ({ getEvents: () => dmFakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockDmRoom);
    mockClient.getRooms.mockReturnValue([mockDmRoom]);

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    expect(onSync).toBeDefined();
    act(() => onSync!('PREPARED'));

    expect(result.current.activeDmMessages).toHaveLength(1);
    expect(result.current.activeDmMessages[0].content).toBe('late arrival');
  });

  // ── dmLastMessages sidebar previews ──

  it('updates dmLastMessages when a DM timeline event arrives', () => {
    mockClient.getRoom.mockReturnValue(null);

    const credsWithDm: MatrixCredentials = {
      ...creds,
      dmRoomMap: { '@bob:example.com': '!dm-bob:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsWithDm), { wrapper });

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    act(() => onSync!('PREPARED'));

    const dmMockRoom = {
      roomId: '!dm-bob:example.com',
      getMember: vi.fn(() => ({ rawDisplayName: 'Bob', name: 'Bob', getAvatarUrl: () => null })),
    };
    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    expect(onTimeline).toBeDefined();

    const fakeEvent = {
      getType: () => 'm.room.message',
      getId: () => '$dm-ev-1',
      getSender: () => '@bob:example.com',
      getContent: () => ({ body: 'dm preview text' }),
      getTs: () => 1_700_000_000_000,
    };

    act(() => onTimeline!(fakeEvent, dmMockRoom));

    expect(result.current.dmLastMessages.get('@bob:example.com')).toEqual({
      content: 'dm preview text',
      ts: 1_700_000_000_000,
      sender: 'Bob',
    });
  });

  it('dmLastMessages are bootstrapped on PREPARED from SDK timelines', () => {
    mockClient.getRoom.mockReturnValue(null);

    const dmRoom = {
      roomId: '!dm-bob:example.com',
      getMember: vi.fn(() => ({ rawDisplayName: 'Bob', name: 'Bob', getAvatarUrl: () => null })),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$e1', getSender: () => '@bob:example.com',
          getContent: () => ({ body: 'first' }), getTs: () => 1000 },
        { getType: () => 'm.room.message', getId: () => '$e2', getSender: () => '@bob:example.com',
          getContent: () => ({ body: 'last one' }), getTs: () => 2000 },
      ]}),
    };
    mockClient.getRooms.mockReturnValue([dmRoom]);

    const credsWithDm: MatrixCredentials = {
      ...creds,
      dmRoomMap: { '@bob:example.com': '!dm-bob:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsWithDm), { wrapper });

    expect(result.current.dmLastMessages.size).toBe(0);

    const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as
      | ((state: string) => void)
      | undefined;
    act(() => onSync!('PREPARED'));

    expect(result.current.dmLastMessages.get('@bob:example.com')).toEqual({
      content: 'last one',
      ts: 2000,
      sender: 'Bob',
    });
  });
});
