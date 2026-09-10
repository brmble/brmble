import { describe, expect, it } from 'vitest';
import type { AclChannelSnapshot, AclRule } from '../types/acl';
import { Permission } from '../types/acl';
import {
  CHANNEL_ENTRY_PERMISSIONS,
  LEGACY_PASSWORD_OPEN_BLOCK_MARKER,
  LEGACY_PASSWORD_TOKEN_PERMISSIONS,
  PASSWORD_DENY_PERMISSIONS,
  PASSWORD_MARKER_PREFIX,
  PASSWORD_TOKEN_PERMISSIONS,
  mergeSimpleChannelAccess,
  readSimpleChannelAccess,
  replaceManagedPassword,
} from './channelAccessAcl';

const snapshot = (acls: AclRule[]): AclChannelSnapshot => ({
  channelId: 7,
  inheritAcls: true,
  groups: [],
  acls,
  fetchedAt: '2026-08-04T18:00:00Z',
  stale: false,
  warning: null,
  snapshotHash: 'hash-7',
});

const localRule = (overrides: Partial<AclRule>): AclRule => ({
  applyHere: true,
  applySubs: false,
  inherited: false,
  userId: null,
  group: null,
  allow: 0,
  deny: 0,
  ...overrides,
});

describe('readSimpleChannelAccess', () => {
  it('reads exact local and inherited group/user join rules', () => {
    const result = readSimpleChannelAccess(snapshot([
      localRule({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }),
      localRule({ userId: 42, allow: CHANNEL_ENTRY_PERMISSIONS }),
      localRule({ group: 'Teachers', allow: CHANNEL_ENTRY_PERMISSIONS, applySubs: true, inherited: true }),
      localRule({ userId: 77, allow: CHANNEL_ENTRY_PERMISSIONS, applySubs: true, inherited: true }),
    ]), new Set(['Classleaders', 'Teachers']));

    expect(result.localGroups).toEqual([{ name: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }]);
    expect(result.inheritedGroupNames).toEqual(['Teachers']);
    expect(result.localUserIds).toEqual([42]);
    expect(result.inheritedUserIds).toEqual([77]);
  });

  it('keeps a local apply-to-subchannels rule advanced', () => {
    const result = readSimpleChannelAccess(snapshot([
      localRule({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS, applySubs: true }),
      localRule({ userId: 42, allow: CHANNEL_ENTRY_PERMISSIONS, applySubs: true }),
    ]), new Set(['Classleaders']));

    expect(result.localGroups).toEqual([]);
    expect(result.localUserIds).toEqual([]);
    expect(result.hasAdvancedRules).toBe(true);
  });

  it('reads supported permissions from an exact local group rule', () => {
    const result = readSimpleChannelAccess(snapshot([
      localRule({
        group: 'Hunters',
        allow: Permission.Traverse | Permission.Enter | Permission.Speak | Permission.TextMessage,
      }),
    ]), new Set(['Hunters']));

    expect(result.localGroups).toEqual([{
      name: 'Hunters',
      allow: Permission.Traverse | Permission.Enter | Permission.Speak | Permission.TextMessage,
    }]);
  });

  it('reads the native current three-rule password block and advanced rules', () => {
    const result = readSimpleChannelAccess(snapshot([
      localRule({ group: 'all', deny: PASSWORD_DENY_PERMISSIONS }),
      localRule({ group: '#class-a', allow: PASSWORD_TOKEN_PERMISSIONS }),
      localRule({ group: `${PASSWORD_MARKER_PREFIX}#class-a` }),
      localRule({ group: '#invite-token', allow: Permission.Enter }),
    ]), new Set());

    expect(result.password).toBe('class-a');
    expect(result.hasManagedGate).toBe(true);
    expect(result.hasAdvancedRules).toBe(true);
  });
});

describe('replaceManagedPassword', () => {
  it('replaces the current block and preserves unrelated rules', () => {
    const unrelatedToken = localRule({ group: '#invite-token', allow: Permission.Enter });
    const result = replaceManagedPassword([
      localRule({ group: 'all', deny: PASSWORD_DENY_PERMISSIONS }),
      localRule({ group: '#old', allow: PASSWORD_TOKEN_PERMISSIONS }),
      localRule({ group: `${PASSWORD_MARKER_PREFIX}#old` }),
      unrelatedToken,
    ], 'new');

    expect(result).toContainEqual(unrelatedToken);
    expect(result).not.toContainEqual(expect.objectContaining({ group: '#old' }));
    expect(result).toContainEqual(expect.objectContaining({ group: '#new', allow: PASSWORD_TOKEN_PERMISSIONS }));
  });

  it('clears the complete managed block without leaving its broad deny', () => {
    const result = replaceManagedPassword([
      localRule({ group: 'all', deny: PASSWORD_DENY_PERMISSIONS }),
      localRule({ group: '#old', allow: PASSWORD_TOKEN_PERMISSIONS }),
      localRule({ group: `${PASSWORD_MARKER_PREFIX}#old` }),
    ], '');

    expect(result).toEqual([]);
  });

  it('migrates the legacy open block and preserves malformed markers', () => {
    const malformed = localRule({ group: `${PASSWORD_MARKER_PREFIX}#custom`, applySubs: true });
    const result = replaceManagedPassword([
      localRule({ group: 'all', deny: LEGACY_PASSWORD_TOKEN_PERMISSIONS }),
      localRule({ group: LEGACY_PASSWORD_OPEN_BLOCK_MARKER }),
      localRule({ group: '#legacy', allow: LEGACY_PASSWORD_TOKEN_PERMISSIONS }),
      localRule({ group: `${PASSWORD_MARKER_PREFIX}#legacy` }),
      malformed,
    ], 'new');

    expect(result).not.toContainEqual(expect.objectContaining({ group: LEGACY_PASSWORD_OPEN_BLOCK_MARKER }));
    expect(result).toContainEqual(expect.objectContaining({ group: '#new', allow: PASSWORD_TOKEN_PERMISSIONS }));
    expect(result).toContainEqual(malformed);
  });

  it('writes the password block before managed local entry grants', () => {
    const groupGrant = localRule({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS });
    const result = replaceManagedPassword([groupGrant, localRule({ group: '#invite', allow: Permission.Enter })], 'class-a');

    expect(result.map(rule => rule.group)).toEqual([
      'all', '#class-a', `${PASSWORD_MARKER_PREFIX}#class-a`, 'Classleaders', '#invite',
    ]);
  });
});

describe('mergeSimpleChannelAccess', () => {
  it('keeps an advanced deny after the managed grant it originally followed without adding a gate', () => {
    const advancedDeny = localRule({ group: 'Classleaders', deny: Permission.Enter });
    const result = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }),
      advancedDeny,
    ]), new Set(['Classleaders']), {
      groups: [{ name: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }],
      userIds: [],
      password: '',
    });

    expect(result.acls.map(rule => rule.group)).toEqual([
      'Classleaders', 'Classleaders',
    ]);
    expect(result.acls[0]).toEqual(expect.objectContaining({
      group: 'Classleaders',
      allow: CHANNEL_ENTRY_PERMISSIONS,
      deny: 0,
    }));
    expect(result.acls[1]).toBe(advancedDeny);
  });

  it('keeps an advanced deny after the managed grant when adding a password', () => {
    const advancedDeny = localRule({ group: 'Classleaders', deny: Permission.Enter });
    const result = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }),
      advancedDeny,
    ]), new Set(['Classleaders']), {
      groups: [{ name: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }],
      userIds: [],
      password: 'class-a',
    });

    expect(result.acls.map(rule => rule.group)).toEqual([
      'all', '#class-a', `${PASSWORD_MARKER_PREFIX}#class-a`, 'Classleaders', 'Classleaders',
    ]);
    expect(result.acls[4]).toBe(advancedDeny);
  });

  it('writes a new managed gate before an existing advanced entry allow', () => {
    const advanced = localRule({ group: '#invite', allow: Permission.Enter });
    const result = mergeSimpleChannelAccess(snapshot([advanced]), new Set(['Classleaders']), {
      groups: [{ name: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }],
      userIds: [42],
      password: '',
    });

    expect(result.acls.map(rule => rule.group ?? rule.userId)).toEqual([
      'all', '#invite', 'Classleaders', 42,
    ]);
    expect(result.acls[0]).toEqual(expect.objectContaining({
      group: 'all',
      deny: CHANNEL_ENTRY_PERMISSIONS,
    }));
    expect(result.acls[1]).toBe(advanced);
  });

  it('writes a new password block before an existing advanced entry allow', () => {
    const advancedAllow = localRule({ group: '#invite', allow: Permission.Enter });

    const result = mergeSimpleChannelAccess(
      snapshot([advancedAllow]),
      new Set(),
      {
        groups: [],
        userIds: [],
        password: 'class-a',
      },
    );

    expect(result.acls.map(rule => rule.group)).toEqual([
      'all',
      '#class-a',
      `${PASSWORD_MARKER_PREFIX}#class-a`,
      '#invite',
    ]);
    expect(result.acls[0]).toEqual(expect.objectContaining({
      group: 'all',
      deny: PASSWORD_DENY_PERMISSIONS,
    }));
    expect(result.acls[3]).toBe(advancedAllow);
  });

  it('writes a new managed gate before a replacement simple entry allow', () => {
    const speakOnly = localRule({ group: 'Classleaders', allow: Permission.Speak });

    const result = mergeSimpleChannelAccess(
      snapshot([speakOnly]),
      new Set(['Classleaders']),
      {
        groups: [{ name: 'Classleaders', allow: Permission.Speak | CHANNEL_ENTRY_PERMISSIONS }],
        userIds: [],
        password: '',
      },
    );

    expect(result.acls.map(rule => rule.group)).toEqual(['all', 'Classleaders']);
    expect(result.acls[0]).toEqual(expect.objectContaining({
      group: 'all',
      deny: CHANNEL_ENTRY_PERMISSIONS,
    }));
    expect(result.acls[1]).toEqual(expect.objectContaining({
      group: 'Classleaders',
      allow: Permission.Speak | CHANNEL_ENTRY_PERMISSIONS,
    }));
  });

  it('removes the managed gate when advanced invite rules are present but no entries remain', () => {
    const gate = localRule({ group: 'all', deny: CHANNEL_ENTRY_PERMISSIONS });
    const invite = localRule({ group: '#invite-token', allow: Permission.Enter });
    const result = mergeSimpleChannelAccess(snapshot([gate, invite]), new Set(), {
      groups: [],
      userIds: [],
      password: '',
    });

    expect(result.acls).toEqual([invite]);
  });

  it('does not create a gate when an unchanged open group rule only grants speak', () => {
    const speakOnly = localRule({ group: 'Moderators', allow: Permission.Speak });

    const result = mergeSimpleChannelAccess(
      snapshot([speakOnly]),
      new Set(['Moderators']),
      {
        groups: [{ name: 'Moderators', allow: Permission.Speak }],
        userIds: [],
        password: '',
      },
    );

    expect(result.acls).toEqual([speakOnly]);
    expect(result.acls).not.toContainEqual(expect.objectContaining({
      group: 'all',
      deny: CHANNEL_ENTRY_PERMISSIONS,
    }));
  });

  it('does not create a gate for an unchanged redundant direct-user grant on an open channel', () => {
    const userGrant = localRule({ userId: 42, allow: CHANNEL_ENTRY_PERMISSIONS });

    const result = mergeSimpleChannelAccess(
      snapshot([userGrant]),
      new Set(),
      {
        groups: [],
        userIds: [42],
        password: '',
      },
    );

    expect(result.acls).toEqual([userGrant]);
    expect(result.acls).not.toContainEqual(expect.objectContaining({
      group: 'all',
      deny: CHANNEL_ENTRY_PERMISSIONS,
    }));
  });

  it('removes the managed gate when the last group is removed', () => {
    const gate = localRule({ group: 'all', deny: CHANNEL_ENTRY_PERMISSIONS });
    const groupGrant = localRule({ group: 'Moderators', allow: CHANNEL_ENTRY_PERMISSIONS });

    const result = mergeSimpleChannelAccess(
      snapshot([gate, groupGrant]),
      new Set(['Moderators']),
      {
        groups: [],
        userIds: [],
        password: '',
      },
    );

    expect(result.acls).toEqual([]);
  });

  it('removes a local all entry deny even when it applies to subchannels', () => {
    const gate = localRule({
      group: 'all',
      applySubs: true,
      deny: CHANNEL_ENTRY_PERMISSIONS,
    });
    const groupGrant = localRule({ group: 'Moderators', allow: CHANNEL_ENTRY_PERMISSIONS });

    const result = mergeSimpleChannelAccess(
      snapshot([gate, groupGrant]),
      new Set(['Moderators']),
      {
        groups: [],
        userIds: [],
        password: '',
      },
    );

    expect(result.acls).toEqual([]);
  });

  it('creates a gate when an entry grant is intentionally added to an open channel', () => {
    const speakOnly = localRule({ group: 'Moderators', allow: Permission.Speak });

    const result = mergeSimpleChannelAccess(
      snapshot([speakOnly]),
      new Set(['Moderators']),
      {
        groups: [{
          name: 'Moderators',
          allow: Permission.Speak | CHANNEL_ENTRY_PERMISSIONS,
        }],
        userIds: [],
        password: '',
      },
    );

    expect(result.acls).toContainEqual(expect.objectContaining({
      group: 'all',
      allow: 0,
      deny: CHANNEL_ENTRY_PERMISSIONS,
    }));
    expect(result.acls).toContainEqual(expect.objectContaining({
      group: 'Moderators',
      allow: Permission.Speak | CHANNEL_ENTRY_PERMISSIONS,
      deny: 0,
    }));
  });

  it('merges group masks while preserving unrelated ACL rules', () => {
    const result = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'Hunters', allow: CHANNEL_ENTRY_PERMISSIONS }),
      localRule({ group: 'moderators', allow: Permission.Kick }),
    ]), new Set(['Hunters']), {
      groups: [{ name: 'Hunters', allow: CHANNEL_ENTRY_PERMISSIONS | Permission.Speak }],
      userIds: [],
      password: '',
    });

    expect(result.acls).toContainEqual(expect.objectContaining({
      group: 'Hunters',
      allow: CHANNEL_ENTRY_PERMISSIONS | Permission.Speak,
    }));
    expect(result.acls).toContainEqual(expect.objectContaining({ group: 'moderators', allow: Permission.Kick }));
  });

  it('keeps a group entry when all of its visible permissions are disabled', () => {
    const result = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'Hunters', allow: CHANNEL_ENTRY_PERMISSIONS }),
    ]), new Set(['Hunters']), { groups: [{ name: 'Hunters', allow: 0 }], userIds: [], password: '' });

    expect(result.acls).toContainEqual(expect.objectContaining({ group: 'Hunters', allow: 0 }));
  });

  it('uses password OR assignment ordering and removes managed access when empty', () => {
    const withPassword = mergeSimpleChannelAccess(snapshot([]), new Set(['Classleaders']), {
      groups: [{ name: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }], userIds: [42], password: 'class-a',
    });
    expect(withPassword.acls.map(rule => rule.group ?? rule.userId)).toEqual([
      'all', '#class-a', `${PASSWORD_MARKER_PREFIX}#class-a`, 'Classleaders', 42,
    ]);

    const cleared = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'all', deny: CHANNEL_ENTRY_PERMISSIONS }),
      localRule({ group: 'custom', deny: Permission.Kick }),
    ]), new Set(), { groups: [], userIds: [], password: '' });
    expect(cleared.acls).toEqual([
      expect.objectContaining({ group: 'custom', deny: Permission.Kick }),
    ]);
  });
});
