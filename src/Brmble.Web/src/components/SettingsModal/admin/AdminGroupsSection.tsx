import { useEffect, useMemo, useRef, useState } from 'react';
import { useAclAdmin } from '../../../hooks/useAclAdmin';
import { confirm } from '../../../hooks/usePrompt';
import { Permission, type AclGroup, type AclRule } from '../../../types/acl';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';

const PASSWORD_MARKER_PREFIX = '__brmble_password_marker__:';
const EMPTY_GROUPS: AclGroup[] = [];
const EMPTY_ACLS: AclRule[] = [];

type DisplayGroup = AclGroup & {
  aclOnly: boolean;
};

type PendingMembershipChange = {
  action: 'add' | 'remove';
  registrationUserId: number;
  registeredName: string;
};

interface GroupPermissionOption {
  label: string;
  mask?: number;
  supported?: boolean;
}

interface GroupPermissionCategory {
  title: string;
  options: GroupPermissionOption[];
}

const GROUP_PERMISSION_CATEGORIES: GroupPermissionCategory[] = [
  {
    title: 'General Permissions',
    options: [
      { label: 'Read Channels', mask: Permission.Traverse },
      { label: 'Write Messages', mask: Permission.TextMessage },
      { label: 'Join Channels', mask: Permission.Enter },
      { label: 'Speak', mask: Permission.Speak },
      { label: 'Priority Speaker', supported: false },
      { label: 'Force Push-To-Talk', supported: false },
    ],
  },
  {
    title: 'Moderation Permissions',
    options: [
      { label: 'Mute Users', mask: Permission.MuteDeafen },
      { label: 'Move Users', mask: Permission.Move },
      { label: 'Kick Users', mask: Permission.Kick },
      { label: 'Ban Users', mask: Permission.Ban },
      { label: 'View Reports', supported: false },
      { label: 'Manage Warnings', supported: false },
    ],
  },
  {
    title: 'Channel Management',
    options: [
      { label: 'Create Channels', mask: Permission.MakeChannel },
      { label: 'Delete Channels', supported: false },
      { label: 'Manage Channel Settings & ACLs', mask: Permission.Write },
      { label: 'Lock Channels', supported: false },
      { label: 'Create Temporary Channels', mask: Permission.MakeTempChannel },
    ],
  },
  {
    title: 'Administrative Permissions',
    options: [
      { label: 'Manage Groups', supported: false },
      { label: 'View Logs', supported: false },
      { label: 'Server Settings', supported: false },
      { label: 'Manage Integrations', supported: false },
    ],
  },
];

export function AdminGroupsSection() {
  const { snapshot, loading, saving, error, refresh, save } = useAclAdmin(0);
  const { registeredUsers, loading: registeredUsersLoading, error: registeredUsersError } = useAdminRegisteredUsers();
  const sourceGroups = snapshot?.groups ?? EMPTY_GROUPS;
  const sourceAcls = snapshot?.acls ?? EMPTY_ACLS;
  const [draftGroups, setDraftGroups] = useState<AclGroup[]>(sourceGroups);
  const [draftAcls, setDraftAcls] = useState<AclRule[]>(sourceAcls);
  const [selectedGroupName, setSelectedGroupName] = useState('');
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const lastSubmittedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sourceSignature = JSON.stringify({ groups: sourceGroups, acls: sourceAcls });
    const shouldHydrate = !hasLocalEdits || lastSubmittedDraftRef.current === sourceSignature;
    if (!shouldHydrate) return;

    setDraftGroups(sourceGroups);
    setDraftAcls(sourceAcls);
    setSelectedGroupName(currentSelectedGroupName => (
      sourceGroups.some(group => group.name === currentSelectedGroupName)
        ? currentSelectedGroupName
        : (sourceGroups[0]?.name ?? '')
    ));
    setHasLocalEdits(false);
    if (lastSubmittedDraftRef.current === sourceSignature) {
      lastSubmittedDraftRef.current = null;
    }
  }, [hasLocalEdits, sourceAcls, sourceGroups]);

  const displayGroups = useMemo<DisplayGroup[]>(() => {
    const groupsByName = new Map<string, DisplayGroup>(
      draftGroups.map(group => [group.name, { ...group, aclOnly: false }]),
    );

    draftAcls.forEach(rule => {
      if (!rule.group || rule.userId != null) return;
      if (rule.group.startsWith('#') || rule.group.startsWith(PASSWORD_MARKER_PREFIX)) return;
      if (groupsByName.has(rule.group)) return;

      groupsByName.set(rule.group, {
        name: rule.group,
        inherited: rule.inherited,
        inherit: true,
        inheritable: true,
        add: [],
        remove: [],
        members: [],
        aclOnly: true,
      });
    });

    return [...groupsByName.values()];
  }, [draftAcls, draftGroups]);

  useEffect(() => {
    setSelectedGroupName(currentSelectedGroupName => (
      displayGroups.some(group => group.name === currentSelectedGroupName)
        ? currentSelectedGroupName
        : (displayGroups[0]?.name ?? '')
    ));
  }, [displayGroups]);

  const selectedGroup = useMemo(
    () => displayGroups.find(group => group.name === selectedGroupName) ?? null,
    [displayGroups, selectedGroupName],
  );
  const selectedEditableGroup = useMemo(
    () => draftGroups.find(group => group.name === selectedGroupName) ?? null,
    [draftGroups, selectedGroupName],
  );

  const selectedGroupPermissions = useMemo(() => {
    if (!selectedGroup) {
      return { local: 0, inherited: 0 };
    }

    return draftAcls
      .filter(rule => rule.group === selectedGroup.name && rule.userId == null)
      .reduce((combined, rule) => ({
        local: combined.local | (rule.inherited ? 0 : rule.allow),
        inherited: combined.inherited | (rule.inherited ? rule.allow : 0),
      }), { local: 0, inherited: 0 });
  }, [draftAcls, selectedGroup]);

  const getSelectedPermissionState = (mask: number) => {
    const local = (selectedGroupPermissions.local & mask) === mask;
    const inherited = (selectedGroupPermissions.inherited & mask) === mask;

    return {
      checked: local || inherited,
      inheritedOnly: inherited && !local,
    };
  };

  const members = useMemo(() => {
    if (!selectedGroup) return [];
    return registeredUsers.filter(user => selectedGroup.members.includes(user.registrationUserId));
  }, [registeredUsers, selectedGroup]);

  const availableUsers = useMemo(() => {
    if (!selectedGroup) return registeredUsers;
    return registeredUsers.filter(user => !selectedGroup.members.includes(user.registrationUserId));
  }, [registeredUsers, selectedGroup]);

  const toggleSelectedGroupPermission = (mask: number, checked: boolean) => {
    if (!selectedGroup) return;

    setHasLocalEdits(true);
    setDraftAcls(currentRules => {
      const matchingRule = (rule: AclRule) => !rule.inherited && rule.userId == null && rule.group === selectedGroup.name;

      if (checked) {
        let updated = false;
        const nextRules = currentRules.map(rule => {
          if (!matchingRule(rule)) return rule;
          updated = true;
          return {
            ...rule,
            allow: rule.allow | mask,
            deny: rule.deny & ~mask,
          };
        });

        if (updated) return nextRules;

        return [
          ...nextRules,
          {
            applyHere: true,
            applySubs: true,
            inherited: false,
            userId: null,
            group: selectedGroup.name,
            allow: mask,
            deny: 0,
          },
        ];
      }

      return currentRules.flatMap(rule => {
        if (!matchingRule(rule)) return [rule];

        const nextRule = {
          ...rule,
          allow: rule.allow & ~mask,
          deny: rule.deny & ~mask,
        };

        if (nextRule.allow === 0 && nextRule.deny === 0) {
          return [];
        }

        return [nextRule];
      });
    });
  };

  const applyMembershipChange = (group: AclGroup, change: PendingMembershipChange): AclGroup => {
    if (change.action === 'add') {
      return {
        ...group,
        members: [...new Set([...group.members, change.registrationUserId])].sort((left, right) => left - right),
        add: group.remove.includes(change.registrationUserId)
          ? group.add
          : [...new Set([...group.add, change.registrationUserId])].sort((left, right) => left - right),
        remove: group.remove.filter(memberId => memberId !== change.registrationUserId),
      };
    }

    return {
      ...group,
      members: group.members.filter(memberId => memberId !== change.registrationUserId),
      add: group.add.filter(memberId => memberId !== change.registrationUserId),
      remove: group.add.includes(change.registrationUserId)
        ? group.remove
        : [...new Set([...group.remove, change.registrationUserId])].sort((left, right) => left - right),
    };
  };

  const requestMemberChange = async (action: PendingMembershipChange['action'], registrationUserId: number, registeredName: string) => {
    if (saving || !selectedGroup || selectedGroup.inherited) return;

    const approved = await confirm({
      title: `${action === 'add' ? 'Add' : 'Remove'} ${registeredName} ${action === 'add' ? 'to' : 'from'} @${selectedGroup.name}?`,
      message: 'This change will be saved immediately.',
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
    });
    if (!approved) return;

    const change: PendingMembershipChange = { action, registrationUserId, registeredName };
    const serverGroup = sourceGroups.find(group => group.name === selectedGroup.name);
    const baseGroup = serverGroup ?? {
      name: selectedGroup.name,
      inherited: false,
      inherit: selectedGroup.inherit,
      inheritable: selectedGroup.inheritable,
      add: [...selectedGroup.add],
      remove: [...selectedGroup.remove],
      members: [...selectedGroup.members],
    };
    const updatedGroup = applyMembershipChange(baseGroup, change);
    const groups = serverGroup
      ? sourceGroups.map(group => group.name === selectedGroup.name ? updatedGroup : group)
      : [...sourceGroups, updatedGroup];

    save({
      inheritAcls: snapshot?.inheritAcls ?? true,
      groups,
      acls: sourceAcls,
    });
  };

  const selectGroup = (name: string) => {
    setSelectedGroupName(name);
  };

  const addGroup = () => {
    const baseName = 'New Group';
    let name = baseName;
    let index = 1;
    const names = new Set(draftGroups.map(group => group.name));
    while (names.has(name)) {
      index += 1;
      name = `${baseName} ${index}`;
    }

    const next = [
      ...draftGroups,
      { name, inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] },
    ];
    setHasLocalEdits(true);
    setDraftGroups(next);
    setSelectedGroupName(name);
  };

  const deleteGroup = () => {
    if (!selectedEditableGroup) return;
    setHasLocalEdits(true);
    const next = draftGroups.filter(group => group.name !== selectedEditableGroup.name);
    setDraftGroups(next);
    setDraftAcls(currentRules => currentRules.filter(rule => rule.group !== selectedEditableGroup.name));
    setSelectedGroupName(next[0]?.name ?? '');
  };

  const cancelChanges = () => {
    setDraftGroups(sourceGroups);
    setDraftAcls(sourceAcls);
    setSelectedGroupName(sourceGroups[0]?.name ?? '');
    setHasLocalEdits(false);
    lastSubmittedDraftRef.current = null;
  };

  const saveChanges = () => {
    lastSubmittedDraftRef.current = JSON.stringify({ groups: draftGroups, acls: draftAcls });
    const payload = {
      inheritAcls: snapshot?.inheritAcls ?? true,
      groups: draftGroups,
      acls: draftAcls,
    };
    save(payload);
  };

  const getPermissionLabel = (option: GroupPermissionOption) => {
    if (option.supported === false) return `${option.label} (Unavailable)`;
    if (option.mask == null) return option.label;

    const permissionState = getSelectedPermissionState(option.mask);
    return permissionState.inheritedOnly ? `${option.label} (Inherited)` : option.label;
  };

  const getDisplayGroupLabel = (groupName: string) => `@${groupName}`;

  return (
    <section className="settings-section admin-section admin-groups-panel">
      <div className="admin-panel-header admin-groups-header">
        <h3 className="heading-section settings-section-title">Groups</h3>
      </div>

      <div className="admin-groups-rail">
        <div className="admin-groups-section-heading">Groups List</div>
        <div className="admin-groups-list">
          {displayGroups.map(group => (
            <button
              key={group.name}
              type="button"
              className={`admin-channel-row ${group.name === selectedGroupName ? 'selected' : ''}`}
              onClick={() => selectGroup(group.name)}
            >
              {getDisplayGroupLabel(group.name)}
            </button>
          ))}
        </div>
        <div className="admin-action-row admin-groups-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addGroup}>Add Group</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={deleteGroup} disabled={!selectedEditableGroup}>Delete Group</button>
        </div>
      </div>

      <div className="admin-groups-transfer">
        <div className="admin-groups-status">
          {error && <div className="admin-error">{error}</div>}
          {registeredUsersError && <div className="admin-error">{registeredUsersError}</div>}
          {(loading || registeredUsersLoading) && <div className="admin-loading">Loading groups and registered users...</div>}
        </div>

        <div className="admin-groups-transfer-grid">
          <div className="admin-groups-pane">
            <h4 className="heading-label">Available users</h4>
            {!loading && !registeredUsersLoading && !selectedGroup && (
              <div className="admin-empty">Select a group to manage its members.</div>
            )}
            {!loading && !registeredUsersLoading && selectedGroup && availableUsers.length === 0 && (
              <div className="admin-empty">All registered users are already in this group.</div>
            )}
            {!loading && !registeredUsersLoading && selectedGroup && availableUsers.length > 0 && (
              <div className="admin-groups-user-list admin-users-table">
                {availableUsers.map(user => (
                  <div key={user.registrationUserId} className="admin-user-row admin-groups-user-row">
                    <div className="admin-user-identity">
                      <span className="admin-user-name">{user.registeredName}</span>
                      <span className="admin-user-meta">Registered ID {user.registrationUserId}</span>
                    </div>
                    <div className="admin-user-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm admin-groups-transfer-button"
                        disabled={selectedGroup.inherited || saving}
                        onClick={() => requestMemberChange('add', user.registrationUserId, user.registeredName)}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-groups-transfer-actions">
            <span className="admin-groups-transfer-label">Transfer actions</span>
          </div>

          <div className="admin-groups-pane">
            <h4 className="heading-label">{selectedGroup ? `Members of "${selectedGroup.name}"` : 'Members'}</h4>
            {!loading && !registeredUsersLoading && !selectedGroup && (
              <div className="admin-empty">Select a group to manage its members.</div>
            )}
            {!loading && !registeredUsersLoading && selectedGroup && members.length === 0 && (
              <div className="admin-empty">No registered users are in this group yet.</div>
            )}
            {!loading && !registeredUsersLoading && selectedGroup && members.length > 0 && (
              <div className="admin-groups-user-list admin-users-table">
                {members.map(user => (
                  <div key={user.registrationUserId} className="admin-user-row admin-groups-user-row">
                    <div className="admin-user-identity">
                      <span className="admin-user-name">{user.registeredName}</span>
                      <span className="admin-user-meta">Registered ID {user.registrationUserId}</span>
                    </div>
                    <div className="admin-user-badges">
                      <span className="admin-user-badge">Member</span>
                    </div>
                    <div className="admin-user-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm admin-groups-transfer-button"
                        disabled={selectedGroup.inherited || saving}
                        onClick={() => requestMemberChange('remove', user.registrationUserId, user.registeredName)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="admin-card admin-groups-permissions">
        <h4 className="heading-label">Group Permissions</h4>
        <div className="admin-groups-permission-sections">
          {GROUP_PERMISSION_CATEGORIES.map(category => (
            <section key={category.title} className="admin-groups-permission-section">
              <h4 className="heading-label">{category.title}</h4>
              <div className="admin-groups-permission-grid">
                {category.options.map(option => (
                  (() => {
                    const permissionState = option.mask == null
                      ? { checked: false, inheritedOnly: false }
                      : getSelectedPermissionState(option.mask);

                    return (
                      <label key={option.label} className="admin-groups-permission-option">
                        <span>{getPermissionLabel(option)}</span>
                        <span className="brmble-toggle">
                          <input
                            type="checkbox"
                            checked={permissionState.checked}
                            disabled={option.supported === false || !selectedGroup || permissionState.inheritedOnly}
                            onChange={event => {
                              if (option.mask == null || permissionState.inheritedOnly) return;
                              toggleSelectedGroupPermission(option.mask, event.target.checked);
                            }}
                          />
                          <span className="brmble-toggle-slider"></span>
                        </span>
                      </label>
                    );
                  })()
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="admin-footer-row">
        <button type="button" className="btn btn-secondary" onClick={cancelChanges}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={saveChanges}>Save Changes</button>
      </div>
    </section>
  );
}
