import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDMStore } from './useDMStore';
import type { DMStoreOptions } from './useDMStore';

function makeOptions(overrides: Partial<DMStoreOptions> = {}): DMStoreOptions {
  return {
    matrixDmLastMessages: new Map(),
    activeDmMessages: [],
    matrixDmRoomMap: new Map(),
    matrixDmUserDisplayNames: new Map(),
    matrixDmUserAvatarUrls: new Map(),
    sendMatrixDM: vi.fn().mockResolvedValue(undefined),
    fetchDMHistory: vi.fn().mockResolvedValue(undefined),
    sendMumbleDM: vi.fn(),
    isSelectedConversationForeground: false,
    users: [{ name: 'me', session: 1 }] as DMStoreOptions['users'],
    username: 'me',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDMStore presentation separation', () => {
  it('selects a contact without exposing presentation mode', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        matrixDmRoomMap: new Map([['@val:example.com', '!val:example.com']]),
      }))
    );

    act(() => result.current.selectContact('@val:example.com'));

    expect(result.current.selectedContact?.id).toBe('@val:example.com');
    expect('appMode' in result.current).toBe(false);
  });

  it('increments unread when App reports the selected conversation is not foreground', () => {
    const { result, rerender } = renderHook(
      ({ isSelectedConversationForeground }) => useDMStore(makeOptions({ isSelectedConversationForeground })),
      { initialProps: { isSelectedConversationForeground: true } },
    );

    act(() => result.current.startMumbleDM('cert-val', 1, 'Val'));
    act(() => result.current.receiveMumbleDM('cert-val', 1, 'Val', 'read while foreground'));
    expect(result.current.contacts.find(contact => contact.id === 'cert-val')?.unreadCount).toBe(0);

    rerender({ isSelectedConversationForeground: false });

    act(() => result.current.receiveMumbleDM('cert-val', 1, 'Val', 'unread while background'));

    expect(result.current.selectedContact?.id).toBe('cert-val');
    expect(result.current.contacts.find(contact => contact.id === 'cert-val')?.unreadCount).toBe(1);
  });
});

describe('useDMStore mumbleMessages cap', () => {
  it('caps mumbleMessages per contact at 200 on receiveMumbleDM', () => {
    const { result } = renderHook(() => useDMStore(makeOptions()));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.receiveMumbleDM('cert-1', 1, 'Alice', `msg-${i}`);
      }
    });

    // Select contact so messages are exposed via .messages
    act(() => result.current.selectContact('cert-1'));

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].content).toBe('msg-10');
    expect(result.current.messages[199].content).toBe('msg-209');
  });

  it('caps mumbleMessages on outgoing Mumble sendMessage', () => {
    const { result } = renderHook(() => useDMStore(makeOptions()));

    act(() => {
      result.current.startMumbleDM('cert-1', 1, 'Alice');
    });

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.sendMessage(`out-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].content).toBe('out-10');
  });
});

describe('useDMStore pendingMessages on Matrix send failure', () => {
  it('removes the optimistic pending message when sendMatrixDM rejects', async () => {
    const sendMatrixDM = vi.fn().mockRejectedValue(new Error('network down'));
    const matrixDmRoomMap = new Map([['@bob:example.com', '!bob:example.com']]);
    const { result } = renderHook(() =>
      useDMStore(makeOptions({ sendMatrixDM, matrixDmRoomMap }))
    );

    act(() => result.current.selectContact('@bob:example.com'));

    await act(async () => {
      result.current.sendMessage('hello');
      // Allow the rejected promise to settle
      await Promise.resolve();
      await Promise.resolve();
    });

    // No pending optimistic message should remain
    const pending = result.current.messages.filter(m => m.pending);
    expect(pending).toHaveLength(0);
  });
});

describe('useDMStore contact directory merge', () => {
  it('includes all known Brmble users even when no DM room exists', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        brmbleUsers: [
          { matrixUserId: '@alice:example.com', displayName: 'Alice' },
          { matrixUserId: '@bob:example.com', displayName: 'Bob' },
        ],
      }))
    );

    expect(result.current.contacts).toEqual([
      expect.objectContaining({ id: '@alice:example.com', displayName: 'Alice' }),
      expect.objectContaining({ id: '@bob:example.com', displayName: 'Bob' }),
    ]);
    expect(result.current.contacts.every(contact => contact.isEphemeral !== true)).toBe(true);
  });

  it('includes online Mumble-only users as ephemeral contacts', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        users: [
          { name: 'me', session: 1, self: true },
          { name: 'Mumble Mike', session: 2, certHash: 'cert-mike' },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts).toEqual([
      expect.objectContaining({
        id: 'cert-mike',
        displayName: 'Mumble Mike',
        isEphemeral: true,
        mumbleCertHash: 'cert-mike',
        mumbleSessionId: 2,
      }),
    ]);
  });

  it('sends to a first-time displayed Mumble-only contact over Mumble', () => {
    const sendMatrixDM = vi.fn().mockResolvedValue(undefined);
    const sendMumbleDM = vi.fn();
    const fetchDMHistory = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        fetchDMHistory,
        sendMatrixDM,
        sendMumbleDM,
        users: [
          { name: 'me', session: 1, self: true },
          { name: 'Mumble Mike', session: 2, certHash: 'cert-mike' },
        ] as DMStoreOptions['users'],
      }))
    );

    act(() => result.current.selectContact('cert-mike'));
    act(() => result.current.sendMessage('hello'));

    expect(sendMumbleDM).toHaveBeenCalledTimes(1);
    expect(sendMumbleDM).toHaveBeenCalledWith(2, 'hello');
    expect(sendMatrixDM).not.toHaveBeenCalled();
    expect(fetchDMHistory).not.toHaveBeenCalled();
  });

  it('treats registered vanilla Mumble users as Mumble contacts', () => {
    const sendMatrixDM = vi.fn().mockResolvedValue(undefined);
    const sendMumbleDM = vi.fn();
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        sendMatrixDM,
        sendMumbleDM,
        users: [
          { name: 'me', session: 1, self: true },
          {
            name: 'Vanilla Val',
            session: 2,
            certHash: 'cert-val',
            matrixUserId: '@val:example.com',
            isBrmbleClient: false,
          },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts).toEqual([
      expect.objectContaining({
        id: 'cert-val',
        displayName: 'Vanilla Val',
        isEphemeral: true,
        mumbleCertHash: 'cert-val',
        mumbleSessionId: 2,
      }),
    ]);

    act(() => result.current.selectContact('cert-val'));
    act(() => result.current.sendMessage('hello'));

    expect(sendMumbleDM).toHaveBeenCalledTimes(1);
    expect(sendMumbleDM).toHaveBeenCalledWith(2, 'hello');
    expect(sendMatrixDM).not.toHaveBeenCalled();
  });

  it('keeps Brmble users in the Matrix contact section when they are online', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        brmbleUsers: [
          { matrixUserId: '@alice:example.com', displayName: 'Alice Offline Name' },
        ],
        users: [
          { name: 'me', session: 1, self: true },
          { name: 'Alice Online Name', session: 2, certHash: 'cert-alice', matrixUserId: '@alice:example.com', isBrmbleClient: true },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.contacts[0]).toEqual(expect.objectContaining({
      id: '@alice:example.com',
      displayName: 'Alice Online Name',
    }));
    expect(result.current.contacts[0].isEphemeral).not.toBe(true);
  });

  it('shows a registered standard-Mumble user in both route sections and keeps transports separate', () => {
    const sendMatrixDM = vi.fn().mockResolvedValue(undefined);
    const sendMumbleDM = vi.fn();
    const fetchDMHistory = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        fetchDMHistory,
        sendMatrixDM,
        sendMumbleDM,
        brmbleUsers: [
          { matrixUserId: '@val:example.com', displayName: 'Val Persistent' },
        ],
        users: [
          { name: 'me', session: 1, self: true, matrixUserId: '@me:example.com', isBrmbleClient: true },
          {
            name: 'Vanilla Val',
            session: 2,
            certHash: 'cert-val',
            matrixUserId: '@val:example.com',
            isBrmbleClient: false,
          },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts).toEqual([
      expect.objectContaining({
        id: '@val:example.com',
        displayName: 'Vanilla Val',
        onlineSessionId: 2,
      }),
      expect.objectContaining({
        id: 'cert-val',
        displayName: 'Vanilla Val',
        isEphemeral: true,
        mumbleCertHash: 'cert-val',
        mumbleSessionId: 2,
      }),
    ]);

    act(() => result.current.selectContact('@val:example.com'));
    act(() => result.current.sendMessage('persistent hello'));

    expect(sendMatrixDM).toHaveBeenCalledTimes(1);
    expect(sendMatrixDM).toHaveBeenCalledWith('@val:example.com', 'persistent hello');
    expect(fetchDMHistory).toHaveBeenCalledWith('@val:example.com');
    expect(sendMumbleDM).not.toHaveBeenCalled();

    act(() => result.current.selectContact('cert-val'));
    act(() => result.current.sendMessage('live hello'));

    expect(sendMumbleDM).toHaveBeenCalledTimes(1);
    expect(sendMumbleDM).toHaveBeenCalledWith(2, 'live hello');
    expect(sendMatrixDM).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        channelId: 'cert-val',
        sender: 'me',
        content: 'live hello',
      }),
    ]);
  });

  it('returns empty Mumble history immediately after selecting a first-time Mumble route', () => {
    const sendMatrixDM = vi.fn().mockResolvedValue(undefined);
    const sendMumbleDM = vi.fn();
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        sendMatrixDM,
        sendMumbleDM,
        activeDmMessages: [
          {
            id: '$matrix-1',
            channelId: '@val:example.com',
            sender: 'Vanilla Val',
            content: 'matrix history',
            timestamp: new Date('2026-07-18T10:00:00Z'),
          },
        ],
        brmbleUsers: [
          { matrixUserId: '@val:example.com', displayName: 'Vanilla Val' },
        ],
        users: [
          { name: 'me', session: 1, self: true },
          {
            name: 'Vanilla Val',
            session: 22,
            certHash: 'cert-val',
            matrixUserId: '@val:example.com',
            isBrmbleClient: false,
          },
        ] as DMStoreOptions['users'],
      }))
    );

    act(() => result.current.selectContact('@val:example.com'));
    expect(result.current.messages.map(message => message.content)).toEqual(['matrix history']);

    act(() => result.current.selectContact('cert-val'));
    expect(result.current.selectedContact).toEqual(expect.objectContaining({ id: 'cert-val', isEphemeral: true }));
    expect(result.current.messages).toEqual([]);

    act(() => result.current.sendMessage('mumble only'));

    expect(result.current.messages.map(message => message.content)).toEqual(['mumble only']);
    expect(sendMumbleDM).toHaveBeenCalledWith(22, 'mumble only');
    expect(sendMatrixDM).not.toHaveBeenCalled();
  });

  it('does not list an online Brmble-client user under Mumble users even when a certHash is present', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        brmbleUsers: [
          { matrixUserId: '@alice:example.com', displayName: 'Alice' },
        ],
        users: [
          { name: 'me', session: 1, self: true },
          {
            name: 'Alice',
            session: 2,
            certHash: 'cert-alice',
            matrixUserId: '@alice:example.com',
            isBrmbleClient: true,
          },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts).toEqual([
      expect.objectContaining({
        id: '@alice:example.com',
        displayName: 'Alice',
      }),
    ]);
    expect(result.current.contacts.some(contact => contact.isEphemeral === true)).toBe(false);
  });

  it('does not list a Brmble-client user under Mumble users before Matrix mapping arrives', () => {
    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        users: [
          { name: 'me', session: 1, self: true },
          {
            name: 'Mapping Soon',
            session: 2,
            certHash: 'cert-soon',
            isBrmbleClient: true,
          },
        ] as DMStoreOptions['users'],
      }))
    );

    expect(result.current.contacts.find(contact => contact.id === 'cert-soon')).toBeUndefined();
  });

  it('keeps existing Mumble history but disables the route when the active user switches to the Brmble client', () => {
    const sendMumbleDM = vi.fn();
    const standardUsers = [
      { name: 'me', session: 1, self: true },
      {
        name: 'Switching Sam',
        session: 2,
        certHash: 'cert-sam',
        matrixUserId: '@sam:example.com',
        isBrmbleClient: false,
      },
    ] as DMStoreOptions['users'];
    const brmbleUsers = [
      { name: 'me', session: 1, self: true },
      {
        name: 'Switching Sam',
        session: 2,
        certHash: 'cert-sam',
        matrixUserId: '@sam:example.com',
        isBrmbleClient: true,
      },
    ] as DMStoreOptions['users'];

    const { result, rerender } = renderHook(
      ({ users }) => useDMStore(makeOptions({ sendMumbleDM, users })),
      { initialProps: { users: standardUsers } },
    );

    act(() => result.current.startMumbleDM('cert-sam', 2, 'Switching Sam'));
    act(() => result.current.sendMessage('before switch'));

    rerender({ users: brmbleUsers });

    const mumbleRoute = result.current.contacts.find(contact => contact.id === 'cert-sam');
    expect(mumbleRoute).toEqual(expect.objectContaining({
      isEphemeral: true,
      mumbleSessionId: null,
      lastMessage: 'before switch',
    }));

    act(() => result.current.selectContact('cert-sam'));
    act(() => result.current.sendMessage('after switch'));

    expect(sendMumbleDM).toHaveBeenCalledTimes(1);
    expect(result.current.messages.map(message => message.content)).toEqual(['before switch']);
  });

  it('removes an unused stored Mumble route when the active user switches to the Brmble client', () => {
    const standardUsers = [
      { name: 'me', session: 1, self: true },
      {
        name: 'Switching Sam',
        session: 2,
        certHash: 'cert-sam',
        matrixUserId: '@sam:example.com',
        isBrmbleClient: false,
      },
    ] as DMStoreOptions['users'];
    const brmbleUsers = [
      { name: 'me', session: 1, self: true },
      {
        name: 'Switching Sam',
        session: 2,
        certHash: 'cert-sam',
        matrixUserId: '@sam:example.com',
        isBrmbleClient: true,
      },
    ] as DMStoreOptions['users'];

    const { result, rerender } = renderHook(
      ({ users }) => useDMStore(makeOptions({ users })),
      { initialProps: { users: standardUsers } },
    );

    act(() => result.current.startMumbleDM('cert-sam', 2, 'Switching Sam'));
    rerender({ users: brmbleUsers });

    expect(result.current.contacts.find(contact => contact.id === 'cert-sam')).toBeUndefined();
  });

  it('excludes the current local user from every Matrix and Mumble contact source', () => {
    const matrixDmRoomMap = new Map([
      ['@me:example.com', '!self:example.com'],
      ['@bob:example.com', '!bob:example.com'],
    ]);

    const { result } = renderHook(() =>
      useDMStore(makeOptions({
        matrixDmRoomMap,
        brmbleUsers: [
          { matrixUserId: '@me:example.com', displayName: 'me' },
          { matrixUserId: '@carol:example.com', displayName: 'Carol' },
        ],
        users: [
          {
            name: 'me',
            session: 1,
            self: true,
            certHash: 'cert-me',
            matrixUserId: '@me:example.com',
            isBrmbleClient: true,
          },
          {
            name: 'Bob',
            session: 2,
            certHash: 'cert-bob',
            matrixUserId: '@bob:example.com',
            isBrmbleClient: true,
          },
        ] as DMStoreOptions['users'],
        username: 'me',
      }))
    );

    act(() => result.current.startDM('@me:example.com', 'me'));
    act(() => result.current.startMumbleDM('cert-me', 1, 'me'));

    expect(result.current.contacts.map(contact => contact.id)).toEqual([
      '@bob:example.com',
      '@carol:example.com',
    ]);
    expect(result.current.selectedContact).toBeNull();
  });

  it('sends later Mumble messages to the newest active session after reconnect', () => {
    const sendMumbleDM = vi.fn();
    const { result, rerender } = renderHook(
      ({ session }) => useDMStore(makeOptions({
          sendMumbleDM,
          users: [
            { name: 'me', session: 1, self: true },
            { name: 'Mumble Mike', session, certHash: 'cert-mike' },
          ] as DMStoreOptions['users'],
        })),
      { initialProps: { session: 2 } },
    );

    act(() => result.current.selectContact('cert-mike'));
    act(() => result.current.sendMessage('first session'));

    expect(sendMumbleDM).toHaveBeenLastCalledWith(2, 'first session');

    rerender({ session: 42 });
    act(() => result.current.selectContact('cert-mike'));
    act(() => result.current.sendMessage('new session'));

    expect(sendMumbleDM).toHaveBeenLastCalledWith(42, 'new session');
    expect(sendMumbleDM).not.toHaveBeenCalledWith(2, 'new session');
  });

  it('keeps a selected first-time Mumble contact on the Mumble route after disconnect', () => {
    const sendMumbleDM = vi.fn();
    const sendMatrixDM = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ users }) => useDMStore(makeOptions({
        sendMumbleDM,
        sendMatrixDM,
        users,
      })),
      {
        initialProps: {
          users: [
            { name: 'me', session: 1, self: true },
            { name: 'Mumble Mike', session: 2, certHash: 'cert-mike' },
          ] as DMStoreOptions['users'],
        },
      },
    );

    act(() => result.current.selectContact('cert-mike'));

    rerender({
      users: [
        { name: 'me', session: 1, self: true },
      ] as DMStoreOptions['users'],
    });

    act(() => result.current.sendMessage('after disconnect'));

    expect(sendMumbleDM).not.toHaveBeenCalled();
    expect(sendMatrixDM).not.toHaveBeenCalledWith('cert-mike', 'after disconnect');
    expect(result.current.selectedContact).toEqual(expect.objectContaining({
      id: 'cert-mike',
      isEphemeral: true,
      mumbleSessionId: null,
    }));
  });
});
