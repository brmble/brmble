import type { AclChannelSnapshot, AclRule, AclUpdateRequest } from '../types/acl';
import { Permission } from '../types/acl';

export const CHANNEL_ENTRY_PERMISSIONS = Permission.Traverse | Permission.Enter;
export const SIMPLE_GROUP_PERMISSIONS = CHANNEL_ENTRY_PERMISSIONS | Permission.Speak | Permission.TextMessage;
export const PASSWORD_TOKEN_PERMISSIONS = CHANNEL_ENTRY_PERMISSIONS
  | Permission.Speak
  | Permission.Whisper
  | Permission.TextMessage
  | Permission.Listen;
export const PASSWORD_DENY_PERMISSIONS = PASSWORD_TOKEN_PERMISSIONS | Permission.MakeTempChannel;
export const LEGACY_PASSWORD_TOKEN_PERMISSIONS = CHANNEL_ENTRY_PERMISSIONS;
export const PASSWORD_MARKER_PREFIX = '__brmble_password_marker__:';
export const LEGACY_PASSWORD_OPEN_BLOCK_MARKER = '__brmble_password_open_block__';

export interface SimpleChannelAccess {
  localGroups: SimpleChannelGroupAccess[];
  inheritedGroupNames: string[];
  localUserIds: number[];
  inheritedUserIds: number[];
  password: string;
  hasManagedGate: boolean;
  hasAdvancedRules: boolean;
}

export interface SimpleChannelGroupAccess {
  name: string;
  allow: number;
}

export interface SimpleChannelAccessDraft {
  groups: SimpleChannelGroupAccess[];
  userIds: number[];
  password: string;
}

const isExactJoinAllow = (rule: AclRule) => (
  rule.applyHere && !rule.applySubs && rule.allow === CHANNEL_ENTRY_PERMISSIONS && rule.deny === 0
);

const isManagedGate = (rule: AclRule) => (
  !rule.inherited && rule.userId == null && rule.group === 'all'
  && rule.applyHere && !rule.applySubs && rule.allow === 0 && rule.deny === CHANNEL_ENTRY_PERMISSIONS
);

const passwordMarkerSelector = (rule: AclRule): string | null => {
  const isExactMarker = !rule.inherited && rule.applyHere && !rule.applySubs
    && rule.userId == null && rule.group?.startsWith(`${PASSWORD_MARKER_PREFIX}#`) === true
    && rule.allow === 0 && rule.deny === 0;
  return isExactMarker ? rule.group!.slice(PASSWORD_MARKER_PREFIX.length) : null;
};

const isExactZeroEffectGroupRule = (rule: AclRule, group: string) => (
  !rule.inherited && rule.applyHere && !rule.applySubs && rule.userId == null
  && rule.group === group && rule.allow === 0 && rule.deny === 0
);

const isManagedPasswordToken = (rule: AclRule, selector: string) => (
  !rule.inherited && rule.applyHere && !rule.applySubs && rule.userId == null
  && rule.group === selector
  && (rule.allow === PASSWORD_TOKEN_PERMISSIONS || rule.allow === LEGACY_PASSWORD_TOKEN_PERMISSIONS)
  && rule.deny === 0
);

const isPasswordDeny = (rule: AclRule, deny: number) => (
  !rule.inherited && rule.applyHere && !rule.applySubs && rule.userId == null
  && rule.group === 'all' && rule.allow === 0 && rule.deny === deny
);

interface ManagedPasswordBlock {
  selector: string;
  indexes: number[];
}

const managedEntryKey = (rule: AclRule): string | null => {
  if (rule.userId != null && rule.group == null) return `user:${rule.userId}`;
  if (rule.userId == null && rule.group != null) return `group:${rule.group}`;
  return null;
};

const createPasswordBlock = (selector: string): AclRule[] => [
  { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: 0, deny: PASSWORD_DENY_PERMISSIONS },
  { applyHere: true, applySubs: false, inherited: false, userId: null, group: selector, allow: PASSWORD_TOKEN_PERMISSIONS, deny: 0 },
  { applyHere: true, applySubs: false, inherited: false, userId: null, group: `${PASSWORD_MARKER_PREFIX}${selector}`, allow: 0, deny: 0 },
];

function managedPasswordBlocks(acls: AclRule[]): ManagedPasswordBlock[] {
  return acls.flatMap((marker, markerIndex): ManagedPasswordBlock[] => {
    const selector = passwordMarkerSelector(marker);
    const tokenIndex = markerIndex - 1;
    if (selector == null || tokenIndex < 0 || !isManagedPasswordToken(acls[tokenIndex], selector)) return [];

    const indexes = [tokenIndex, markerIndex];
    if (tokenIndex >= 1 && isPasswordDeny(acls[tokenIndex - 1], PASSWORD_DENY_PERMISSIONS)) {
      indexes.unshift(tokenIndex - 1);
    } else if (
      tokenIndex >= 2
      && isPasswordDeny(acls[tokenIndex - 2], LEGACY_PASSWORD_TOKEN_PERMISSIONS)
      && isExactZeroEffectGroupRule(acls[tokenIndex - 1], LEGACY_PASSWORD_OPEN_BLOCK_MARKER)
    ) {
      indexes.unshift(tokenIndex - 2, tokenIndex - 1);
    }
    return [{ selector, indexes }];
  });
}

const isManagedLocalEntryGrant = (rule: AclRule) => {
  const isDirectUser = rule.userId != null && rule.group == null;
  const isNamedGroup = rule.userId == null && rule.group != null && rule.group !== 'all'
    && !rule.group.startsWith('#') && !rule.group.startsWith(PASSWORD_MARKER_PREFIX)
    && rule.group !== LEGACY_PASSWORD_OPEN_BLOCK_MARKER;
  return !rule.inherited && isExactJoinAllow(rule) && (isDirectUser || isNamedGroup);
};

export function replaceManagedPassword(acls: AclRule[], password: string): AclRule[] {
  const managedIndexes = new Set(managedPasswordBlocks(acls).flatMap(block => block.indexes));
  const normalized = password.trim().replace(/^#/, '');
  if (!normalized) return acls.filter((_, index) => !managedIndexes.has(index));

  const selector = `#${normalized}`;
  const passwordBlock = createPasswordBlock(selector);
  const blockStart = managedPasswordBlocks(acls)
    .flatMap(block => block.indexes)
    .reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY);
  const firstGrant = acls.findIndex(isManagedLocalEntryGrant);
  const insertionIndex = Number.isFinite(blockStart) ? blockStart : firstGrant >= 0 ? firstGrant : acls.length;
  const result: AclRule[] = [];
  let inserted = false;
  acls.forEach((rule, index) => {
    if (!inserted && index === insertionIndex) {
      result.push(...passwordBlock);
      inserted = true;
    }
    if (!managedIndexes.has(index)) result.push(rule);
  });
  if (!inserted) result.push(...passwordBlock);
  return result;
}

function isSimpleGroupRule(rule: AclRule, knownGroups: ReadonlySet<string>) {
  return rule.userId == null && rule.group != null && knownGroups.has(rule.group)
    && rule.applyHere && !rule.applySubs && rule.deny === 0
    && (rule.allow & ~SIMPLE_GROUP_PERMISSIONS) === 0;
}

function isSimpleUserRule(rule: AclRule) {
  return rule.userId != null && rule.group == null && isExactJoinAllow(rule);
}

export function readSimpleChannelAccess(
  snapshot: AclChannelSnapshot,
  knownRootGroupNames: ReadonlySet<string>,
): SimpleChannelAccess {
  const passwordBlocks = managedPasswordBlocks(snapshot.acls);
  const managedPasswordIndexes = new Set(passwordBlocks.flatMap(block => block.indexes));
  const localGroups: SimpleChannelGroupAccess[] = [];
  const inheritedGroupNames: string[] = [];
  const localUserIds: number[] = [];
  const inheritedUserIds: number[] = [];
  const password = passwordBlocks[0]?.selector.replace(/^#/, '') ?? '';
  let hasAdvancedRules = false;

  snapshot.acls.forEach((rule, index) => {
    if (isManagedGate(rule) || managedPasswordIndexes.has(index)) return;
    if (isSimpleGroupRule(rule, knownRootGroupNames)) {
      if (rule.inherited) inheritedGroupNames.push(rule.group!);
      else localGroups.push({ name: rule.group!, allow: rule.allow });
      return;
    }
    if (isSimpleUserRule(rule)) {
      (rule.inherited ? inheritedUserIds : localUserIds).push(rule.userId!);
      return;
    }
    hasAdvancedRules = true;
  });

  return {
    localGroups: [...new Map(localGroups.map(group => [group.name, group])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    inheritedGroupNames: [...new Set(inheritedGroupNames)].sort(),
    localUserIds: [...new Set(localUserIds)].sort((a, b) => a - b),
    inheritedUserIds: [...new Set(inheritedUserIds)].sort((a, b) => a - b),
    password,
    hasManagedGate: snapshot.acls.some(isManagedGate) || passwordBlocks.length > 0,
    hasAdvancedRules,
  };
}

export function mergeSimpleChannelAccess(
  snapshot: AclChannelSnapshot,
  knownRootGroupNames: ReadonlySet<string>,
  draft: SimpleChannelAccessDraft,
): Pick<AclUpdateRequest, 'inheritAcls' | 'groups' | 'acls'> {
  const managedPasswordIndexes = new Set(managedPasswordBlocks(snapshot.acls).flatMap(block => block.indexes));
  const managedPasswordStart = managedPasswordBlocks(snapshot.acls)
    .flatMap(block => block.indexes)
    .reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY);

  const groups = [...new Map(draft.groups
    .map(group => [group.name, { name: group.name, allow: group.allow & SIMPLE_GROUP_PERMISSIONS }] as const))
    .values()]
    .filter(group => knownRootGroupNames.has(group.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const userIds = [...new Set(draft.userIds)].filter(id => Number.isInteger(id) && id >= 0).sort((a, b) => a - b);
  const password = draft.password.trim().replace(/^#/, '');
  const hasAdvancedRules = readSimpleChannelAccess(snapshot, knownRootGroupNames).hasAdvancedRules;
  const managed: AclRule[] = [];
  if (!password && (groups.length > 0 || userIds.length > 0)) {
    managed.push({ applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: 0, deny: CHANNEL_ENTRY_PERMISSIONS });
  }
  managed.push(...groups.map(({ name, allow }) => ({
    applyHere: true,
    applySubs: false,
    inherited: false,
    userId: null,
    group: name,
    allow,
    deny: 0,
  })));
  managed.push(...userIds.map(userId => ({ applyHere: true, applySubs: false, inherited: false, userId, group: null, allow: CHANNEL_ENTRY_PERMISSIONS, deny: 0 })));

  const managedEntryRules = managed.filter(rule => !isManagedGate(rule) && managedEntryKey(rule) != null);
  const managedByKey = new Map(managedEntryRules
    .map(rule => [managedEntryKey(rule)!, rule] as const));
  const usedManagedKeys = new Set<string>();
  const acls: AclRule[] = [];
  let insertedPassword = false;
  let retainedGate = false;

  snapshot.acls.forEach((rule, index) => {
    if (rule.inherited) return;
    if (managedPasswordIndexes.has(index)) {
      if (!insertedPassword && index === managedPasswordStart && password) {
        acls.push(...createPasswordBlock(`#${password}`));
        insertedPassword = true;
      }
      return;
    }
    if (isManagedGate(rule)) {
      if (!password && (managed.length > 0 || hasAdvancedRules) && !retainedGate) {
        acls.push(rule);
        retainedGate = true;
      }
      return;
    }
    if (isSimpleGroupRule(rule, knownRootGroupNames) || isSimpleUserRule(rule)) {
      const key = managedEntryKey(rule);
      const replacement = key == null ? undefined : managedByKey.get(key);
      if (replacement && key != null && !usedManagedKeys.has(key)) {
        if (password && !insertedPassword) {
          acls.push(...createPasswordBlock(`#${password}`));
          insertedPassword = true;
        } else if (!password && managed.length > 0 && !retainedGate) {
          acls.push({ applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: 0, deny: CHANNEL_ENTRY_PERMISSIONS });
          retainedGate = true;
        }
        acls.push(replacement);
        usedManagedKeys.add(key);
      }
      return;
    }
    acls.push(rule);
  });

  const newManaged = managedEntryRules.filter(rule => {
    const key = managedEntryKey(rule);
    return key == null || !usedManagedKeys.has(key);
  });
  if (password && !insertedPassword) acls.push(...createPasswordBlock(`#${password}`));
  if (!password && managed.length > 0 && !retainedGate) {
    acls.push({ applyHere: true, applySubs: false, inherited: false, userId: null, group: 'all', allow: 0, deny: CHANNEL_ENTRY_PERMISSIONS });
  }
  acls.push(...newManaged);

  return {
    inheritAcls: snapshot.inheritAcls,
    groups: snapshot.groups.filter(group => !group.inherited),
    acls,
  };
}
