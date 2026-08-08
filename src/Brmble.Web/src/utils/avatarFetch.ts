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
  /** The projection delivers an explicit null for an identity the server has not resolved. */
  matrixUserId?: string | null;
  avatarUrl?: string;
}

/** What is known about a fetch already made for a Matrix user. */
export interface AvatarFetchRecord {
  attempts: number;
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

/**
 * Whether this user still needs their avatar fetched.
 *
 * The avatar map is keyed by matrixUserId, not by session: an avatar belongs to a person
 * rather than to a connection. So a reconnect onto a new session is no longer a reason to
 * fetch again — the avatar already resolved for that identity is still correct. The session
 * comparison this used to make became wrong when avatars moved out of the user rows.
 */
export function shouldFetchAvatar(
  user: AvatarFetchCandidate | undefined,
  fetched: ReadonlyMap<string, AvatarFetchRecord>,
): boolean {
  if (!user?.matrixUserId || user.avatarUrl) return false;
  return !fetched.has(user.matrixUserId);
}
