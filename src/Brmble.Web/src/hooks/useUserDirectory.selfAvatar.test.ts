import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserDirectory } from './useUserDirectory';
import type { User } from '../types';

const SELF = '@me:test';

const selfRow = (matrixUserId: string | null): User =>
  ({ session: 1, name: 'Me', self: true, matrixUserId, companionId: null, isBrmbleClient: null }) as unknown as User;

describe('useUserDirectory self avatar', () => {
  it('keeps my own avatar when the server stops stating my mapping', () => {
    // A Brmble server restart makes the client apply a snapshot that does not yet mention this
    // session, and ApplyServerSnapshot correctly resets the server-owned half to unknown --
    // matrixUserId included. My own avatar comes from my own Matrix client, not from the
    // server, so it must not vanish just because the server has gone quiet about me.
    const { result } = renderHook(() => useUserDirectory(SELF));

    act(() => {
      result.current.reset([selfRow(SELF)]);
      result.current.setAvatar(SELF, 'https://x/me.png');
    });
    expect(result.current.users[0].avatarUrl).toBe('https://x/me.png');

    // The restart: the row survives, its server-owned fields go back to unknown.
    act(() => {
      result.current.apply({ changed: [selfRow(null)], removed: [] });
    });

    expect(result.current.users[0].matrixUserId).toBeNull();
    expect(result.current.users[0].avatarUrl).toBe('https://x/me.png');
  });

  it('does not invent an avatar for another user whose mapping is unknown', () => {
    // The fallback is only ever legitimate for self, because only for self does the client hold
    // an identity the server has not told it.
    const { result } = renderHook(() => useUserDirectory(SELF));

    act(() => {
      result.current.setAvatar(SELF, 'https://x/me.png');
      result.current.reset([
        { session: 2, name: 'Alice', self: false, matrixUserId: null } as unknown as User,
      ]);
    });

    expect(result.current.users[0].avatarUrl).toBeUndefined();
  });

  it('still resolves my avatar normally once the server restates my mapping', () => {
    const { result } = renderHook(() => useUserDirectory(SELF));

    act(() => {
      result.current.reset([selfRow(SELF)]);
      result.current.setAvatar(SELF, 'https://x/me.png');
    });

    expect(result.current.users[0].avatarUrl).toBe('https://x/me.png');
  });
});
