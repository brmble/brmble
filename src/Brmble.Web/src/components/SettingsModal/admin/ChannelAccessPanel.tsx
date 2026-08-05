import { useEffect, useMemo, useState } from 'react';
import type { Channel } from '../../../types';
import { useAclAdmin } from '../../../hooks/useAclAdmin';
import {
  mergeSimpleChannelAccess,
  readSimpleChannelAccess,
  SIMPLE_GROUP_PERMISSIONS,
  type SimpleChannelAccessDraft,
} from '../../../utils/channelAccessAcl';
import { Permission } from '../../../types/acl';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';
import { Select } from '../../Select';
import './ChannelAccessPanel.css';

interface ChannelAccessPanelProps {
  channel: Channel;
  parentName: string;
}

export function ChannelAccessPanel({ channel, parentName }: ChannelAccessPanelProps) {
  const channelAcl = useAclAdmin(channel.id);
  const rootAcl = useAclAdmin(0);
  const users = useAdminRegisteredUsers();
  const [draft, setDraft] = useState<SimpleChannelAccessDraft>({ groups: [], userIds: [], password: '' });
  const [groupToAdd, setGroupToAdd] = useState('');
  const [userToAdd, setUserToAdd] = useState('');

  useEffect(() => {
    channelAcl.refresh();
    rootAcl.refresh();
  }, [channel.id, channelAcl.refresh, rootAcl.refresh]);

  const rootGroups = useMemo(
    () => (rootAcl.snapshot?.groups ?? []).filter(group => !group.inherited && group.inheritable),
    [rootAcl.snapshot],
  );
  const rootGroupNames = useMemo(() => new Set(rootGroups.map(group => group.name)), [rootGroups]);
  const access = useMemo(
    () => channelAcl.snapshot ? readSimpleChannelAccess(channelAcl.snapshot, rootGroupNames) : null,
    [channelAcl.snapshot, rootGroupNames],
  );
  const accessSignature = access ? JSON.stringify(access) : '';

  useEffect(() => {
    if (!access) return;
    setDraft({ groups: access.localGroups, userIds: access.localUserIds, password: access.password });
  // Hydrate only when canonical ACL-derived values change, not when a hook
  // recreates an equivalent snapshot object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessSignature]);

  const namesById = useMemo(
    () => new Map(users.registeredUsers.map(user => [user.registrationUserId, user.registeredName])),
    [users.registeredUsers],
  );

  const save = () => {
    if (!channelAcl.snapshot) return;
    channelAcl.save(mergeSimpleChannelAccess(channelAcl.snapshot, rootGroupNames, draft));
  };

  const removeGroup = (name: string) => setDraft(current => ({
    ...current,
    groups: current.groups.filter(group => group.name !== name),
  }));

  const updateGroupPermission = (name: string, mask: number, checked: boolean) => {
    setDraft(current => ({
      ...current,
      groups: current.groups.map(group => {
        if (group.name !== name) return group;
        const nextMask = checked ? group.allow | mask : group.allow & ~mask;
        if (mask !== Permission.Enter) return { ...group, allow: nextMask };
        return { ...group, allow: checked ? nextMask | Permission.Traverse : nextMask & ~Permission.Traverse };
      }),
    }));
  };

  const removeUser = (userId: number) => setDraft(current => ({
    ...current,
    userIds: current.userIds.filter(id => id !== userId),
  }));

  return (
    <div className="channel-access-panel">
      <dl className="channel-access-summary">
        <div><dt>Description</dt><dd>{channel.description || 'No description'}</dd></div>
        <div><dt>Parent channel</dt><dd>{parentName}</dd></div>
        <div><dt>ACL inheritance</dt><dd>{channelAcl.snapshot?.inheritAcls ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>

      {(channelAcl.error || rootAcl.error || users.error) && (
        <div className="admin-error">{channelAcl.error ?? rootAcl.error ?? users.error}</div>
      )}
      {access?.hasAdvancedRules && (
        <p className="admin-help-text">This channel also has advanced ACL rules. They will be preserved.</p>
      )}

      <section aria-labelledby={`channel-${channel.id}-groups`}>
        <h5 id={`channel-${channel.id}-groups`}>Allowed groups</h5>
        <ul>
          {access?.inheritedGroupNames.map(name => <li key={`inherited-${name}`}>@{name} <span>(inherited)</span></li>)}
          {draft.groups.map(group => (
            <li key={group.name} className="channel-access-group-row">
              <span className="channel-access-group-name">@{group.name}</span>
              <div className="channel-access-group-controls">
                <span className="channel-access-permission-control">
                  <label className="brmble-toggle">
                    <input
                      type="checkbox"
                      aria-label={`${group.name} Speak`}
                      checked={(group.allow & Permission.Speak) !== 0}
                      onChange={event => updateGroupPermission(group.name, Permission.Speak, event.target.checked)}
                    />
                    <span className="brmble-toggle-slider" />
                  </label>
                  <span>Speak</span>
                </span>
                <span className="channel-access-permission-control">
                  <label className="brmble-toggle">
                    <input
                      type="checkbox"
                      aria-label={`${group.name} Write`}
                      checked={(group.allow & Permission.TextMessage) !== 0}
                      onChange={event => updateGroupPermission(group.name, Permission.TextMessage, event.target.checked)}
                    />
                    <span className="brmble-toggle-slider" />
                  </label>
                  <span>Write</span>
                </span>
                <span className="channel-access-permission-control">
                  <label className="brmble-toggle">
                    <input
                      type="checkbox"
                      aria-label={`${group.name} Enter`}
                      checked={(group.allow & Permission.Enter) !== 0}
                      onChange={event => updateGroupPermission(group.name, Permission.Enter, event.target.checked)}
                    />
                    <span className="brmble-toggle-slider" />
                  </label>
                  <span>Enter</span>
                </span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeGroup(group.name)}>Remove {group.name}</button>
              </div>
            </li>
          ))}
        </ul>
        <label>
          <span>Group to add</span>
          <Select
            ariaLabel="Group to add"
            value={groupToAdd}
            onChange={setGroupToAdd}
            placeholder="Select a group"
            options={rootGroups
              .filter(group => !draft.groups.some(draftGroup => draftGroup.name === group.name))
              .map(group => ({ value: group.name, label: group.name }))}
          />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!groupToAdd} onClick={() => {
          setDraft(current => ({
            ...current,
            groups: [...current.groups, { name: groupToAdd, allow: SIMPLE_GROUP_PERMISSIONS }]
              .sort((a, b) => a.name.localeCompare(b.name)),
          }));
          setGroupToAdd('');
        }}>Add group</button>
      </section>

      <section aria-labelledby={`channel-${channel.id}-users`}>
        <h5 id={`channel-${channel.id}-users`}>Allowed registered users</h5>
        <ul>
          {access?.inheritedUserIds.map(id => <li key={`inherited-${id}`}>{namesById.get(id) ?? `Registered user ${id}`} <span>(inherited)</span></li>)}
          {draft.userIds.map(id => (
            <li key={id}>
              {namesById.get(id) ?? `Registered user ${id}`}
              <button type="button" onClick={() => removeUser(id)}>Remove {namesById.get(id) ?? `user ${id}`}</button>
            </li>
          ))}
        </ul>
        <label>
          <span>Registered user to add</span>
          <Select
            ariaLabel="Registered user to add"
            value={userToAdd}
            onChange={setUserToAdd}
            placeholder="Select a user"
            options={users.registeredUsers
              .filter(user => !draft.userIds.includes(user.registrationUserId))
              .map(user => ({ value: String(user.registrationUserId), label: user.registeredName }))}
          />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!userToAdd} onClick={() => {
          const registrationUserId = Number.parseInt(userToAdd, 10);
          setDraft(current => ({ ...current, userIds: [...new Set([...current.userIds, registrationUserId])].sort((a, b) => a - b) }));
          setUserToAdd('');
        }}>Add user</button>
      </section>

      <label className="channel-access-password">
        <span>Channel password — visible to administrators</span>
        <input
          aria-label="Channel password — visible to administrators"
          className="brmble-input"
          type="text"
          value={draft.password}
          autoComplete="off"
          onChange={event => setDraft(current => ({ ...current, password: event.target.value }))}
        />
      </label>

      <div className="admin-action-row">
        <button type="button" className="btn btn-primary" disabled={!channelAcl.snapshot || channelAcl.saving || channelAcl.snapshot.stale} onClick={save}>
          {channelAcl.saving ? 'Saving...' : 'Save access settings'}
        </button>
      </div>
    </div>
  );
}
