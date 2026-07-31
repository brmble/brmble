import { describe, it, expect } from 'vitest';
import { pruneFetchedAvatars, shouldFetchAvatar, type AvatarFetchRecord } from './avatarFetch';

describe('avatar fetch bookkeeping', () => {
  it('fetches for a user who has no avatar yet', () => {
    const fetched = new Map<string, AvatarFetchRecord>();
    expect(shouldFetchAvatar({ session: 1, matrixUserId: '@broan:x' }, fetched)).toBe(true);
  });

  it('does not fetch again for a user who already has an avatar', () => {
    const fetched = new Map<string, AvatarFetchRecord>([['@broan:x', { attempts: 1, session: 1 }]]);
    const user = { session: 1, matrixUserId: '@broan:x', avatarUrl: 'https://x/a.png' };
    expect(shouldFetchAvatar(user, fetched)).toBe(false);
  });

  it('forgets a user who left, so a later visit is fetched again', () => {
    const fetched = new Map<string, AvatarFetchRecord>([['@broan:x', { attempts: 1, session: 1 }]]);
    pruneFetchedAvatars(fetched, [{ session: 2, matrixUserId: '@query:x' }]);
    expect(fetched.has('@broan:x')).toBe(false);
  });

  it('fetches again when a user reconnects onto a new session in one update', () => {
    // A reconnect that replaces the old session in the same update never leaves a state
    // where the user is absent, so nothing prunes the record of the previous fetch. The
    // new session carries no avatar, and the record must not be read as though it does.
    const fetched = new Map<string, AvatarFetchRecord>([['@broan:x', { attempts: 1, session: 1 }]]);
    const afterReconnect = [{ session: 77, matrixUserId: '@broan:x' }];

    pruneFetchedAvatars(fetched, afterReconnect);

    expect(shouldFetchAvatar(afterReconnect[0], fetched)).toBe(true);
  });
});
