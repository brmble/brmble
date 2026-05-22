import { useEffect, useMemo, useRef, useState } from 'react';
import { useAclAdmin } from '../../../hooks/useAclAdmin';
import type { Channel } from '../../../types';
import { Permission, type AclGroup, type AclRule } from '../../../types/acl';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';
import { useAdminGroupCatalog } from './useAdminGroupCatalog';

const PASSWORD_MARKER_PREFIX = '__brmble_password_marker__:';

type DisplayGroup = AclGroup & {
  aclOnly: boolean;
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

interface AdminGroupsSectionProps {
  channels?: Channel[];
}

export function AdminGroupsSection({ channels = [] }: AdminGroupsSectionProps) {
  const isCatalogMode = channels.length > 0;
  const { snapshot, loading: snapshotLoading, error: snapshotError, refresh, save } = useAclAdmin(isCatalogMode ? null : 0);
  const { groups: catalogGroups, acls: catalogAcls, loading: catalogLoading, error: catalogError, warning: catalogWarning } = useAdminGroupCatalog(channels);
  const { registeredUsers, loading: registeredUsersLoading, error: registeredUsersError } = useAdminRegisteredUsers();
  const sourceGroups = useMemo(() => (isCatalogMode ? catalogGroups : (snapshot?.groups ?? [])), [catalogGroups, isCatalogMode, snapshot]);
  const sourceAcls = useMemo(() => (isCatalogMode ? catalogAcls : (snapshot?.acls ?? [])), [catalogAcls, isCatalogMode, snapshot]);
  const loading = isCatalogMode ? catalogLoading : snapshotLoading;
  const error = isCatalogMode ? catalogError : snapshotError;
  const [draftGroups, setDraftGroups] = useState<AclGroup[]>(sourceGroups);
  const [draftAcls, setDraftAcls] = useState<AclRule[]>(sourceAcls);
  const [selectedGroupName, setSelectedGroupName] = useState('');
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const lastSubmittedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCatalogMode) return;
    refresh();
  }, [isCatalogMode, refresh]);

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

  const updateSelectedGroupMembers = (updater: (group: AclGroup) => AclGroup) => {
    if (!selectedEditableGroup) return;
    setHasLocalEdits(true);
    setDraftGroups(currentGroups => currentGroups.map(group => (
      group.name === selectedEditableGroup.name ? updater(group) : group
    )));
  };

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

  const addMember = (registrationUserId: number) => {
    if (isCatalogMode) return;
    updateSelectedGroupMembers(group => ({
      ...group,
      members: [...new Set([...group.members, registrationUserId])].sort((left, right) => left - right),
    }));
  };

  const removeMember = (registrationUserId: number) => {
    if (isCatalogMode) return;
    updateSelectedGroupMembers(group => ({
      ...group,
      members: group.members.filter(memberId => memberId !== registrationUserId),
    }));
  };

  const addGroup = () => {
    if (isCatalogMode) return;
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
    if (isCatalogMode) return;
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
    if (isCatalogMode) return;
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
              onClick={() => setSelectedGroupName(group.name)}
            >
              {getDisplayGroupLabel(group.name)}
            </button>
          ))}
        </div>
        <div className="admin-action-row admin-groups-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addGroup} disabled={isCatalogMode}>Add Group</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={deleteGroup} disabled={isCatalogMode || !selectedEditableGroup}>Delete Group</button>
        </div>
      </div>

      <div className="admin-groups-transfer">
        <div className="admin-groups-status">
          {error && <div className="admin-error">{error}</div>}
          {registeredUsersError && <div className="admin-error">{registeredUsersError}</div>}
          {catalogWarning && !error && <div className="admin-warning">{catalogWarning}</div>}
          {(loading || registeredUsersLoading) && <div className="admin-loading">Loading groups and registered users...</div>}
          {isCatalogMode && !loading && !error && (
            <div className="admin-help-text">Showing groups aggregated from all Mumble channels.</div>
          )}
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
                        disabled={isCatalogMode}
                        onClick={() => addMember(user.registrationUserId)}
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
                        disabled={isCatalogMode}
                        onClick={() => removeMember(user.registrationUserId)}
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
              <h5 className="heading-label">{category.title}</h5>
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
                            disabled={isCatalogMode || option.supported === false || !selectedGroup || permissionState.inheritedOnly}
                            onChange={event => {
                              if (isCatalogMode || option.mask == null || permissionState.inheritedOnly) return;
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
        <button type="button" className="btn btn-secondary" onClick={cancelChanges} disabled={isCatalogMode}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={saveChanges} disabled={isCatalogMode}>Save Changes</button>
      </div>
    </section>
  );
}
