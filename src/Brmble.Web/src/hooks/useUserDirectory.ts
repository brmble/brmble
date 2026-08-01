import { useCallback, useMemo, useRef, useState } from 'react';
import type { User } from '../types';

export interface UserChangeSet {
  changed: User[];
  removed: number[];
}

/**
 * Index-by-session replace and remove, with no field logic whatsoever.
 *
 * Rows arriving from the bridge are complete — every field present, nulls explicit — because
 * UserProjectionStore has already merged them. Any coalescing or defined-check added here
 * re-introduces the class of bug this project exists to remove: a merge rule on the consumer
 * side that disagrees with the one on the producer side.
 */
export function applyChangeSet(previous: User[], change: UserChangeSet): User[] {
  let next = previous;

  if (change.removed.length > 0) {
    const dropped = new Set(change.removed);
    next = next.filter(user => !dropped.has(user.session));
  }

  if (change.changed.length > 0) {
    const incoming = new Map(change.changed.map(user => [user.session, user]));
    // A map hit is always a complete row object, so a truthiness test is a row-level swap
    // rather than a field-level fallback. No coalescing or defined-checks appear here by
    // design: every one of them would be a merge rule competing with the store's.
    next = next.map(user => {
      const replacement = incoming.get(user.session);
      return replacement ? replacement : user;
    });
    for (const user of change.changed) {
      if (!previous.some(existing => existing.session === user.session)) next = [...next, user];
    }
  }

  return next;
}

/**
 * Owns the user list and the avatar map, joining them for consumers.
 */
export function useUserDirectory() {
  const [users, setUsers] = useState<User[]>([]);
  // Keyed by matrixUserId, not session: an avatar belongs to a person, not to a connection, so
  // it survives reconnects and is shared by every session that person has open.
  const [avatars, setAvatars] = useState<Map<string, string>>(() => new Map());

  const reset = useCallback((rows: User[]) => setUsers(rows), []);
  const apply = useCallback(
    (change: UserChangeSet) => setUsers(previous => applyChangeSet(previous, change)),
    [],
  );
  const setAvatar = useCallback((matrixUserId: string, url: string | undefined) => {
    setAvatars(previous => {
      if (previous.get(matrixUserId) === url) return previous;
      const next = new Map(previous);
      if (url === undefined) next.delete(matrixUserId);
      else next.set(matrixUserId, url);
      return next;
    });
  }, []);

  // The join happens at read time so a snapshot can never clobber an avatar.
  const joined = useMemo(
    () => users.map(user => ({
      ...user,
      avatarUrl: user.matrixUserId ? avatars.get(user.matrixUserId) : undefined,
    })),
    [users, avatars],
  );

  // Tracks the joined list so callbacks can read the current users without re-subscribing.
  const usersRef = useRef(joined);
  usersRef.current = joined;

  return { users: joined, usersRef, avatars, reset, apply, setAvatar };
}
