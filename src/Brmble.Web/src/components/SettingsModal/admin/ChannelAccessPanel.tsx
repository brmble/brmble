import { useEffect, useMemo, useRef, useState } from 'react';
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
  scoped?: boolean;
}

const BUILT_IN_ACL_GROUPS = new Set(['all', 'auth', 'in', 'out', 'sub']);

const isEditableScopedGroup = (group: string | null): group is string => (
  group != null
  && /^[A-Za-z0-9_-]+$/.test(group)
  && !BUILT_IN_ACL_GROUPS.has(group)
);

export function ChannelAccessPanel({ channel, parentName, scoped = false }: ChannelAccessPanelProps) {
  const channelAcl = useAclAdmin(channel.id);
  const rootAcl = useAclAdmin(scoped ? null : 0);
  const users = useAdminRegisteredUsers(!scoped);
  const [draft, setDraft] = useState<SimpleChannelAccessDraft>({ groups: [], userIds: [], password: '' });
  const [groupToAdd, setGroupToAdd] = useState('');
  const [userToAdd, setUserToAdd] = useState('');
  const [baselineSignature, setBaselineSignature] = useState<string | null>(null);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const submittedDraftSignatureRef = useRef<string | null>(null);
  const refreshChannelAcl = channelAcl.refresh;
  const refreshRootAcl = rootAcl.refresh;

  useEffect(() => {
    refreshChannelAcl();
    if (!scoped) refreshRootAcl();
  }, [channel.id, refreshChannelAcl, refreshRootAcl, scoped]);

  const rootGroups = useMemo(
    () => (rootAcl.snapshot?.groups ?? []).filter(group => !group.inherited && group.inheritable),
    [rootAcl.snapshot],
  );
  const rootGroupNames = useMemo(() => {
    if (!scoped) return new Set(rootGroups.map(group => group.name));

    return new Set([
      ...(channelAcl.snapshot?.groups ?? []).map(group => group.name),
      ...(channelAcl.snapshot?.acls ?? [])
        .map(rule => rule.group)
        .filter(isEditableScopedGroup),
    ]);
  }, [channelAcl.snapshot, rootGroups, scoped]);
  const access = useMemo(
    () => channelAcl.snapshot ? readSimpleChannelAccess(channelAcl.snapshot, rootGroupNames) : null,
    [channelAcl.snapshot, rootGroupNames],
  );
  const canonicalDraft = useMemo<SimpleChannelAccessDraft | null>(() => access ? ({
    groups: access.localGroups,
    userIds: access.localUserIds,
    password: access.password,
  }) : null, [access]);
  const canonicalDraftSignature = canonicalDraft ? JSON.stringify(canonicalDraft) : '';
  const draftSignature = JSON.stringify(draft);

  useEffect(() => {
    if (!canonicalDraft) return;

    if (baselineSignature == null) {
      // Canonical ACL data arrives asynchronously and is the source used to hydrate this editor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(canonicalDraft);
      setBaselineSignature(canonicalDraftSignature);
      setHasExternalChanges(false);
      return;
    }

    if (canonicalDraftSignature === baselineSignature) return;

    const submittedDraftSignature = submittedDraftSignatureRef.current;
    if (submittedDraftSignature != null && canonicalDraftSignature === submittedDraftSignature) {
      if (draftSignature === submittedDraftSignature) {
        setDraft(canonicalDraft);
      }
      submittedDraftSignatureRef.current = null;
      setBaselineSignature(canonicalDraftSignature);
      setHasExternalChanges(false);
      return;
    }

    if (draftSignature === baselineSignature) {
      setDraft(canonicalDraft);
      submittedDraftSignatureRef.current = null;
      setBaselineSignature(canonicalDraftSignature);
      setHasExternalChanges(false);
      return;
    }

    setHasExternalChanges(true);
  }, [baselineSignature, canonicalDraft, canonicalDraftSignature, draftSignature]);

  const namesById = useMemo(
    () => new Map(users.registeredUsers.map(user => [user.registrationUserId, user.registeredName])),
    [users.registeredUsers],
  );

  const save = () => {
    if (!channelAcl.snapshot || hasExternalChanges) return;
    submittedDraftSignatureRef.current = draftSignature;
    channelAcl.save(mergeSimpleChannelAccess(channelAcl.snapshot, rootGroupNames, draft));
  };

  const reloadServerChanges = () => {
    if (!canonicalDraft) return;
    setDraft(canonicalDraft);
    submittedDraftSignatureRef.current = null;
    setBaselineSignature(canonicalDraftSignature);
    setHasExternalChanges(false);
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

      {(channelAcl.error || (!scoped && (rootAcl.error || users.error))) && (
        <div className="admin-error">{channelAcl.error ?? rootAcl.error ?? users.error}</div>
      )}
      {access?.hasAdvancedRules && (
        <p className="admin-help-text">This channel also has advanced ACL rules. They will be preserved.</p>
      )}
      {scoped && (
        <p className="admin-help-text">
          You can edit existing channel access entries and the password. Adding groups or registered users requires a server administrator.
        </p>
      )}
      {hasExternalChanges && (
        <div className="admin-warning" role="alert">
          <p>Access settings changed on the server.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reloadServerChanges}>
            Reload server changes
          </button>
        </div>
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
        {!scoped && (
          <>
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
          </>
        )}
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
        {!scoped && (
          <>
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
          </>
        )}
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
        <button type="button" className="btn btn-primary" disabled={!channelAcl.snapshot || channelAcl.saving || channelAcl.snapshot.stale || hasExternalChanges} onClick={save}>
          {channelAcl.saving ? 'Saving...' : 'Save access settings'}
        </button>
      </div>
    </div>
  );
}
