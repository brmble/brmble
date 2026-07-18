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
    users: [{ name: 'me', session: 1 }] as DMStoreOptions['users'],
    username: 'me',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
