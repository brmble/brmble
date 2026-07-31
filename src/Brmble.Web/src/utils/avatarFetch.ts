/**
 * Decides which users still need an avatar fetched.
 *
 * Avatars are fetched from bridge events but the decision is derived from the user list, so
 * a fetch is never lost just because the event that would have triggered it arrived before
 * the mapping it referred to. That makes the record of what has already been fetched the
 * only thing that can suppress a fetch, which is why it is kept here rather than inline.
 */

export interface AvatarFetchCandidate {
  session: number;
  matrixUserId?: string;
  avatarUrl?: string;
}

/** What is known about a fetch already made for a Matrix user. */
export interface AvatarFetchRecord {
  attempts: number;
  /** Voice session the fetch was made for. */
  session: number;
}

/**
 * Drops records for Matrix users who are no longer present, so a user who reconnects is
 * fetched again rather than being suppressed by the record of their previous visit.
 */
export function pruneFetchedAvatars(
  fetched: Map<string, AvatarFetchRecord>,
  users: readonly AvatarFetchCandidate[],
): void {
  const present = new Set(users.filter(u => u.matrixUserId).map(u => u.matrixUserId!));
  for (const matrixUserId of [...fetched.keys()]) {
    if (!present.has(matrixUserId)) fetched.delete(matrixUserId);
  }
}

/** Whether this user still needs their avatar fetched. */
export function shouldFetchAvatar(
  user: AvatarFetchCandidate | undefined,
  fetched: ReadonlyMap<string, AvatarFetchRecord>,
): boolean {
  if (!user?.matrixUserId || user.avatarUrl) return false;
  const record = fetched.get(user.matrixUserId);
  if (!record) return true;
  // The fetch on record was made for a different voice session, so its result was applied
  // to a user this one has since replaced. A reconnect that swaps the session in a single
  // update never leaves the user absent for the prune to notice, so this is the only thing
  // standing between the new session and an avatar it does not have.
  return record.session !== user.session;
}
