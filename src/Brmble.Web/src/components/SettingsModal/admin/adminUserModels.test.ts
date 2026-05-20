import { describe, expect, it } from 'vitest';
import { buildAdminUserRows } from './adminUserModels';

describe('buildAdminUserRows', () => {
  it('soft-merges registered and connected rows when the normalized name matches exactly', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [{ registrationUserId: 12, registeredName: 'Alice' }],
      connectedUsers: [{ session: 7, name: 'Alice' }],
      bannedUsers: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      displayName: 'Alice',
      isRegistered: true,
      isConnected: true,
      registrationUserId: 12,
      sessionId: 7,
    });
  });

  it('keeps ambiguous rows separate when only a fuzzy-ish name relationship exists', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [{ registrationUserId: 12, registeredName: 'Alice' }],
      connectedUsers: [{ session: 7, name: 'Alice_' }],
      bannedUsers: [],
    });

    expect(rows).toHaveLength(2);
  });

  it('matches search against names and ban metadata', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [],
      connectedUsers: [],
      bannedUsers: [{ banIndex: 3, name: '', address: '10.0.0.4', hash: 'abc123', reason: 'spam', start: 1700000000, duration: 0 }],
    });

    expect(rows[0].searchText).toContain('10.0.0.4');
    expect(rows[0].searchText).toContain('abc123');
  });
});
