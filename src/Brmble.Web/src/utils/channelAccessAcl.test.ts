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
      localRule({ group: 'Teachers', allow: CHANNEL_ENTRY_PERMISSIONS, inherited: true }),
      localRule({ userId: 77, allow: CHANNEL_ENTRY_PERMISSIONS, inherited: true }),
    ]), new Set(['Classleaders', 'Teachers']));

    expect(result.localGroupNames).toEqual(['Classleaders']);
    expect(result.inheritedGroupNames).toEqual(['Teachers']);
    expect(result.localUserIds).toEqual([42]);
    expect(result.inheritedUserIds).toEqual([77]);
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
      '#invite', 'all', '#class-a', `${PASSWORD_MARKER_PREFIX}#class-a`, 'Classleaders',
    ]);
  });
});

describe('mergeSimpleChannelAccess', () => {
  it('preserves advanced rules and adds the exact managed gate and grants', () => {
    const advanced = localRule({ group: '#invite', allow: Permission.Enter });
    const result = mergeSimpleChannelAccess(snapshot([advanced]), new Set(['Classleaders']), {
      groupNames: ['Classleaders'],
      userIds: [42],
      password: '',
    });

    expect(result.acls[0]).toEqual(advanced);
    expect(result.acls).toContainEqual(expect.objectContaining({ group: 'all', deny: CHANNEL_ENTRY_PERMISSIONS }));
    expect(result.acls).toContainEqual(expect.objectContaining({ group: 'Classleaders', allow: CHANNEL_ENTRY_PERMISSIONS }));
    expect(result.acls).toContainEqual(expect.objectContaining({ userId: 42, allow: CHANNEL_ENTRY_PERMISSIONS }));
  });

  it('uses password OR assignment ordering and removes managed access when empty', () => {
    const withPassword = mergeSimpleChannelAccess(snapshot([]), new Set(['Classleaders']), {
      groupNames: ['Classleaders'], userIds: [42], password: 'class-a',
    });
    expect(withPassword.acls.map(rule => rule.group ?? rule.userId)).toEqual([
      'all', '#class-a', `${PASSWORD_MARKER_PREFIX}#class-a`, 'Classleaders', 42,
    ]);

    const cleared = mergeSimpleChannelAccess(snapshot([
      localRule({ group: 'all', deny: CHANNEL_ENTRY_PERMISSIONS }),
      localRule({ group: 'custom', deny: Permission.Kick }),
    ]), new Set(), { groupNames: [], userIds: [], password: '' });
    expect(cleared.acls).toEqual([expect.objectContaining({ group: 'custom', deny: Permission.Kick })]);
  });
});
