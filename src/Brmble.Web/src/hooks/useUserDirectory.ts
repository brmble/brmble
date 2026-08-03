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
    // Membership is decided against `previous`, not `next`, so a row replaced above is not
    // also appended. Set membership and one concatenation keep this linear; a scan per
    // candidate would go quadratic on a large snapshot arriving after a reset.
    const known = new Set(previous.map(user => user.session));
    const appended = change.changed.filter(user => !known.has(user.session));
    if (appended.length > 0) next = [...next, ...appended];
  }

  return next;
}

/**
 * Owns the user list and the avatar map, joining them for consumers.
 *
 * @param selfMatrixUserId
 * This client's own Matrix id, taken from its own credentials. It is the one identity the
 * client knows without being told, and the join falls back to it for the self row.
 */
export function useUserDirectory(selfMatrixUserId?: string) {
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
  //
  // The self row falls back to this client's own Matrix id. A server that has not stated our
  // mapping -- a Brmble restart, before it has re-synced its session table from Mumble --
  // correctly resets the server-owned half of every row to unknown, matrixUserId included.
  // Our own avatar comes from our own Matrix client, not from the server, so it must not
  // vanish when the server goes quiet about us.
  //
  // The fallback is deliberately confined to the self row: for anybody else an unknown mapping
  // genuinely means there is no identity to look up, and substituting one would show a face
  // that is not theirs.
  const joined = useMemo(
    () => users.map(user => {
      const key = user.self ? (user.matrixUserId ?? selfMatrixUserId) : user.matrixUserId;
      return { ...user, avatarUrl: key ? avatars.get(key) : undefined };
    }),
    [users, avatars, selfMatrixUserId],
  );

  // Tracks the joined list so callbacks can read the current users without re-subscribing.
  const usersRef = useRef(joined);
  usersRef.current = joined;

  return { users: joined, usersRef, avatars, reset, apply, setAvatar };
}
