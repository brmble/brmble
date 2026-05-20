import { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { AclRule, AclUpdateRequest } from '../../types/acl';
import { Permission } from '../../types/acl';
import { useAclAdmin } from '../../hooks/useAclAdmin';
import bridge from '../../bridge';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import './AclEditorDialog.css';

type AclDraft = Omit<AclUpdateRequest, 'expectedSnapshotHash'>;

interface AclEditorDialogProps {
  channelId: number;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
  availableUsers?: Pick<User, 'session' | 'name' | 'channelId'>[];
  isNativePasswordProtected?: boolean;
}

type SharedAccessKind = 'password' | 'token' | 'group';

function ToggleControl({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <div className="acl-toggle">
      <label className="brmble-toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="brmble-toggle-slider" />
      </label>
      <span>{label}</span>
    </div>
  );
}

interface SharedAccessEntry {
  kind: SharedAccessKind;
  selector: string;
  allow: number;
  deny: number;
  applyHere: boolean;
  applySubs: boolean;
  markerRuleIndex?: number;
  sourceRuleIndex: number;
}

interface OtherAccessEntry {
  key: string;
  kind: 'password' | 'token';
  title: string;
  description: string;
  selector: string;
  allow: number;
  deny: number;
  applyHere: boolean;
  applySubs: boolean;
  markerRuleIndex?: number;
  sourceRuleIndex: number;
}

interface DirectUserEntry {
  userId: number;
  allow: number;
  deny: number;
  applyHere: boolean;
  applySubs: boolean;
  sourceRuleIndex: number;
}

interface RegisteredUserOption {
  id: number;
  name: string;
}

const PASSWORD_MARKER_PREFIX = '__brmble_password_marker__:';
const ALL_USERS_SELECTOR = 'all';
const MODERATOR_PERMISSIONS = Permission.Kick | Permission.Ban | Permission.Move | Permission.MuteDeafen;
const CHANNEL_ENTRY_PERMISSIONS = Permission.Enter | Permission.Traverse;

function buildSharedAccessEntries(acls: AclRule[]): SharedAccessEntry[] {
  const markerBySelector = new Map<string, number>();
  acls.forEach((rule, index) => {
    if (rule.group?.startsWith(PASSWORD_MARKER_PREFIX)) {
      markerBySelector.set(rule.group.slice(PASSWORD_MARKER_PREFIX.length), index);
    }
  });

  return acls.flatMap((rule, index): SharedAccessEntry[] => {
    if (rule.inherited || rule.userId != null || !rule.group) return [];
    if (rule.group.startsWith(PASSWORD_MARKER_PREFIX)) return [];

    return [{
      kind: markerBySelector.has(rule.group) ? 'password' : rule.group.startsWith('#') ? 'token' : 'group',
      selector: rule.group,
      allow: rule.allow,
      deny: rule.deny,
      applyHere: rule.applyHere,
      applySubs: rule.applySubs,
      markerRuleIndex: markerBySelector.get(rule.group),
      sourceRuleIndex: index,
    }];
  });
}

function buildDirectUserEntries(acls: AclRule[]): DirectUserEntry[] {
  return acls.flatMap((rule, index): DirectUserEntry[] => (
    !rule.inherited && rule.userId != null
      ? [{
          userId: rule.userId,
          allow: rule.allow,
          deny: rule.deny,
          applyHere: rule.applyHere,
          applySubs: rule.applySubs,
          sourceRuleIndex: index,
        }]
      : []
  ));
}

export function AclEditorDialog({ channelId, channelName, isOpen, onClose, availableUsers = [], isNativePasswordProtected = false }: AclEditorDialogProps) {
  const { snapshot, loading, saving, error, refresh, save, savePassword } = useAclAdmin(isOpen ? channelId : null);
  const [draft, setDraft] = useState<AclDraft | null>(null);
  const [pendingApprovedSession, setPendingApprovedSession] = useState('');
  const [pendingBlockedSession, setPendingBlockedSession] = useState('');
  const [pendingModeratorSession, setPendingModeratorSession] = useState('');
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [passwordToggleFocused, setPasswordToggleFocused] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUserOption[]>([]);
  const [registeredUsersError, setRegisteredUsersError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleRegisteredUsers = (data: unknown) => {
      if (!data || typeof data !== 'object') {
        setRegisteredUsers([]);
        return;
      }

      const nextUsers = Array.isArray(data)
        ? (data as unknown[])
          .map(item => {
            if (!item || typeof item !== 'object') return null;
            const candidate = item as Record<string, unknown>;
            const rawId = candidate.id ?? candidate.userId ?? candidate.key;
            const rawName = candidate.name ?? candidate.displayName ?? candidate.value;
            const id = typeof rawId === 'number'
              ? rawId
              : typeof rawId === 'string'
                ? Number.parseInt(rawId, 10)
                : Number.NaN;
            return !Number.isNaN(id) && typeof rawName === 'string'
              ? { id, name: rawName }
              : null;
          })
          .filter((user): user is RegisteredUserOption => user !== null)
          .sort((a, b) => a.name.localeCompare(b.name))
        : Object.entries(data as Record<string, unknown>)
          .map(([key, value]) => {
            const id = Number.parseInt(key, 10);
            return !Number.isNaN(id) && typeof value === 'string'
              ? { id, name: value }
              : null;
          })
          .filter((user): user is RegisteredUserOption => user !== null)
          .sort((a, b) => a.name.localeCompare(b.name));

      setRegisteredUsers(nextUsers);
    };

    const handleRegisteredUsersError = (data: unknown) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setRegisteredUsersError(null);
        return;
      }

      const message = (data as { message?: unknown }).message;
      setRegisteredUsersError(typeof message === 'string' ? message : null);
    };

    setRegisteredUsersError(null);
    bridge.on('voice.registeredUsers', handleRegisteredUsers);
    bridge.on('voice.registeredUsersError', handleRegisteredUsersError);
    bridge.send('voice.getRegisteredUsers');

    return () => {
      bridge.off('voice.registeredUsers', handleRegisteredUsers);
      bridge.off('voice.registeredUsersError', handleRegisteredUsersError);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!snapshot) return;
    setDraft({
      inheritAcls: snapshot.inheritAcls,
      groups: snapshot.groups,
      acls: snapshot.acls,
    });
    setPasswordPending(false);
  }, [snapshot]);

  const applyDraft = (updater: (current: AclDraft) => AclDraft | null, options?: { persist?: boolean }) => {
    let nextDraft: AclDraft | null = null;
    setDraft(current => {
      if (!current) return current;
      nextDraft = updater(current);
      return nextDraft;
    });

    if (options?.persist && nextDraft && !saving && !snapshot?.stale) {
      save(nextDraft);
    }
  };

  const removeRule = (index: number, options?: { persist?: boolean }) => {
    applyDraft(current => ({
      ...current,
      acls: current.acls.filter((_, i) => i !== index),
    }), options);
  };

  const removeManagedAllUsersDenyRule = (options?: { persist?: boolean }) => {
    applyDraft(current => ({
      ...current,
      acls: current.acls.filter(rule => {
        // Only remove rules that match the exact managed whitelist pattern:
        // - Not inherited
        // - No userId (group rule)
        // - group === 'all'
        // - allow === 0 (no allow bits)
        // - deny === Enter|Traverse (ONLY these bits)
        // - applyHere === true, applySubs === false
        const isExactManagedRule = !rule.inherited 
          && rule.userId == null 
          && rule.group === ALL_USERS_SELECTOR
          && rule.allow === 0
          && rule.deny === CHANNEL_ENTRY_PERMISSIONS
          && rule.applyHere === true
          && rule.applySubs === false;
        return !isExactManagedRule;
      }),
    }), options);
  };

  const toggleWhitelistMode = (enabled: boolean) => {
    if (enabled) {
      applyDraft(current => {
        const base = current;
        // Check if we already have an exact managed whitelist rule
        const existingManagedIndex = base.acls.findIndex(rule => 
          !rule.inherited 
          && rule.userId == null 
          && rule.group === ALL_USERS_SELECTOR
          && rule.allow === 0
          && rule.deny === CHANNEL_ENTRY_PERMISSIONS
          && rule.applyHere === true
          && rule.applySubs === false
        );
        
        // If exact managed rule exists, nothing to do
        if (existingManagedIndex >= 0) {
          return base;
        }

        // Add new managed whitelist rule rather than replacing existing 'all' rules
        const whitelistRule: AclRule = {
          applyHere: true,
          applySubs: false,
          inherited: false,
          userId: null,
          group: ALL_USERS_SELECTOR,
          allow: 0,
          deny: CHANNEL_ENTRY_PERMISSIONS,
        };
        
        return { ...base, acls: [...base.acls, whitelistRule] };
      }, { persist: true });
      return;
    }

    removeManagedAllUsersDenyRule({ persist: true });
  };

  const addOrUpdateDirectUserRule = (userId: number, allow: number, deny: number) => {
    applyDraft(current => {
      const base = current;
      const nextRule: AclRule = {
        applyHere: true,
        applySubs: false,
        inherited: false,
        userId,
        group: null,
        allow,
        deny,
      };
      const existingIndex = base.acls.findIndex(rule => !rule.inherited && rule.userId === userId);

      if (existingIndex >= 0) {
        return {
          ...base,
          acls: base.acls.map((rule, index) => index === existingIndex ? nextRule : rule),
        };
      }

      return {
        ...base,
        acls: [...base.acls, nextRule],
      };
    }, { persist: true });
  };

  const addBlockedUserRule = (userId: number) => {
    applyDraft(current => {
      const base = current;
      const rule: AclRule = {
        applyHere: true,
        applySubs: false,
        inherited: false,
        userId,
        group: null,
        allow: 0,
        deny: CHANNEL_ENTRY_PERMISSIONS,
      };
      return { ...base, acls: [...base.acls, rule] };
    }, { persist: true });
  };

  const addPasswordRule = () => {
    if (passwordEntry) return;
    setPasswordInput('');
    setPasswordPending(true);
  };

  const removePasswordRule = () => savePassword('');

  const sharedAccessEntries = useMemo(
    () => draft ? buildSharedAccessEntries(draft.acls) : [],
    [draft],
  );

  const otherAccessEntries = useMemo((): OtherAccessEntry[] => (
    sharedAccessEntries
      .filter((entry): entry is SharedAccessEntry & { kind: 'password' | 'token' } => entry.kind !== 'group')
      .map(entry => ({
        key: `${entry.kind}-${entry.sourceRuleIndex}`,
        kind: entry.kind,
        title: entry.kind === 'password' ? 'Channel password' : 'Invite token',
        description: entry.kind === 'password'
          ? 'People who know this password can join the channel.'
          : 'People with this invite token can join the channel.',
        selector: entry.selector,
        allow: entry.allow,
        deny: entry.deny,
        applyHere: entry.applyHere,
        applySubs: entry.applySubs,
        markerRuleIndex: entry.markerRuleIndex,
        sourceRuleIndex: entry.sourceRuleIndex,
      }))
  ), [sharedAccessEntries]);

  const directUserEntries = useMemo(
    () => draft ? buildDirectUserEntries(draft.acls) : [],
    [draft],
  );
  const directAccessEntries = useMemo(
    () => directUserEntries.filter(entry => (entry.allow & CHANNEL_ENTRY_PERMISSIONS) !== 0 && (entry.deny & CHANNEL_ENTRY_PERMISSIONS) === 0),
    [directUserEntries],
  );
  const approvedEntries = useMemo(
    () => directAccessEntries.filter(entry => (entry.allow & MODERATOR_PERMISSIONS) === 0),
    [directAccessEntries],
  );
  const moderatorEntries = useMemo(
    () => directAccessEntries.filter(entry => (entry.allow & MODERATOR_PERMISSIONS) === MODERATOR_PERMISSIONS),
    [directAccessEntries],
  );
  const blockedUserEntries = useMemo(
    () => directUserEntries.filter(entry => (entry.deny & CHANNEL_ENTRY_PERMISSIONS) !== 0),
    [directUserEntries],
  );

  const availableUsersBySession = useMemo(
    () => new Map(availableUsers.map(user => [user.session, user])),
    [availableUsers],
  );
  const whitelistRule = draft?.acls.find(rule => !rule.inherited && rule.userId == null && rule.group === ALL_USERS_SELECTOR && (rule.deny & CHANNEL_ENTRY_PERMISSIONS) === CHANNEL_ENTRY_PERMISSIONS) ?? null;
  const approvedMembers = approvedEntries.map(entry => entry.userId);
  const moderatorMembers = moderatorEntries.map(entry => entry.userId);
  const whitelistEnabled = !!whitelistRule;
  const passwordEntry = otherAccessEntries.find(entry => entry.kind === 'password') ?? null;
  const passwordEntryValue = passwordEntry?.selector ?? '';
  const passwordDirty = passwordInput !== passwordEntryValue;
  const passwordEnabled = !!passwordEntry || passwordPending;
  const passwordRequiresValue = passwordEnabled && passwordEntryValue.trim().length === 0;
  const passwordCanSave = passwordDirty && passwordInput.trim().length > 0;
  const showPasswordActions = passwordEnabled && (passwordRequiresValue || passwordDirty);
  const knownUsers = useMemo(
    () => [...registeredUsers].sort((a, b) => a.name.localeCompare(b.name)),
    [registeredUsers],
  );

  const approvedUserAddCandidates = useMemo(() => {
    const memberSet = new Set(approvedMembers);
    return knownUsers.filter(user => !memberSet.has(user.id) && !moderatorMembers.includes(user.id));
  }, [approvedMembers, knownUsers, moderatorMembers]);
  const blockedUserAddCandidates = useMemo(() => {
    const blockedUserIds = new Set(blockedUserEntries.map(entry => entry.userId));
    return knownUsers.filter(user => !blockedUserIds.has(user.id));
  }, [blockedUserEntries, knownUsers]);
  const moderatorAddCandidates = useMemo(() => {
    const memberSet = new Set(moderatorMembers);
    return knownUsers.filter(user => !memberSet.has(user.id));
  }, [knownUsers, moderatorMembers]);

  useEffect(() => {
    setPendingApprovedSession(current => (
      current && approvedUserAddCandidates.some(user => String(user.id) === current)
        ? current
        : approvedUserAddCandidates[0] ? String(approvedUserAddCandidates[0].id) : ''
    ));
  }, [approvedUserAddCandidates]);

  useEffect(() => {
    setPendingBlockedSession(current => (
      current && blockedUserAddCandidates.some(user => String(user.id) === current)
        ? current
        : blockedUserAddCandidates[0] ? String(blockedUserAddCandidates[0].id) : ''
    ));
  }, [blockedUserAddCandidates]);

  useEffect(() => {
    setPendingModeratorSession(current => (
      current && moderatorAddCandidates.some(user => String(user.id) === current)
        ? current
        : moderatorAddCandidates[0] ? String(moderatorAddCandidates[0].id) : ''
    ));
  }, [moderatorAddCandidates]);

  useEffect(() => {
    setPasswordInput(passwordEntryValue);
    setShowPassword(false);
    setPasswordToggleFocused(false);
  }, [passwordEntryValue]);

  const inheritedRules = draft?.acls.filter(rule => rule.inherited) ?? [];

  const canSave = !!draft && !saving && !snapshot?.stale;
  const interactionsDisabled = saving || loading || !draft || !!snapshot?.stale;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="acl-editor glass-panel animate-slide-up" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <button className="modal-close acl-editor-close" type="button" onClick={onClose} aria-label="Close ACL editor">
          <Icon name="x" size={20} />
        </button>

        <div className="modal-header acl-editor-header">
          <h2 className="heading-title modal-title">Permissions for {channelName}</h2>
          <p className="modal-subtitle">Choose who can join, who can moderate, and who is blocked. Then save your channel access rules.</p>
        </div>

        {loading && <div className="acl-banner">Loading ACL state...</div>}
        {error && <div className="acl-banner acl-banner-warning">{error}</div>}
        {snapshot?.stale && <div className="acl-banner acl-banner-warning">Cached ACL state is stale. Refresh before editing.</div>}
        {registeredUsersError && <div className="acl-banner acl-banner-warning">{registeredUsersError}</div>}
        {draft && (
          <>
            <section className="acl-section">
              <div className="acl-section-header">
                <h3 className="heading-section settings-section-title">Defaults</h3>
              </div>

              <ToggleControl
                checked={draft.inheritAcls}
                disabled={interactionsDisabled}
                label="Inherit ACLs from the parent channel"
                onChange={checked => setDraft({ ...draft, inheritAcls: checked })}
              />
            </section>

            <section className="acl-section">
              <div className="acl-section-header acl-section-header--split">
                <div>
                  <h3 className="heading-section settings-section-title">Channel access</h3>
                  <p className="acl-section-copy">Set who can join, protect the channel with a password, and pick moderators.</p>
                </div>
                <div className="acl-toolbar">
                  <button className="btn btn-secondary" type="button" onClick={refresh} disabled={loading || saving}>Refresh</button>
                </div>
              </div>
              <div className="acl-simple-grid">
                <section className="acl-simple-card">
                  <div className="acl-pane-header">
                    <h3 className="heading-section settings-section-title">Who can join</h3>
                    <p className="acl-section-copy">Choose whether the channel is open or only approved users can join.</p>
                  </div>
                  <div className="acl-access-choice-list" role="group" aria-label="Who can join">
                    <button
                      type="button"
                      className={`acl-access-choice${!whitelistEnabled ? ' acl-access-choice--active' : ''}`}
                      aria-label="Everyone can join"
                      aria-pressed={!whitelistEnabled}
                      disabled={interactionsDisabled}
                      onClick={() => toggleWhitelistMode(false)}
                    >
                      <span className="acl-access-choice-indicator" aria-hidden="true" />
                      <span className="acl-access-choice-body">
                        <span className="acl-access-choice-title">Everyone can join</span>
                        <span className="acl-access-choice-copy">Open access for anyone in the server.</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`acl-access-choice${whitelistEnabled ? ' acl-access-choice--active' : ''}`}
                      aria-label="Only approved users can join"
                      aria-pressed={whitelistEnabled}
                      disabled={interactionsDisabled}
                      onClick={() => toggleWhitelistMode(true)}
                    >
                      <span className="acl-access-choice-indicator" aria-hidden="true" />
                      <span className="acl-access-choice-body">
                        <span className="acl-access-choice-title">Approved users only</span>
                        <span className="acl-access-choice-copy">Limit entry to the approved list below.</span>
                      </span>
                    </button>
                  </div>

                  {whitelistEnabled && (
                    <div className="acl-simple-list">
                      <div className="acl-list-header">
                        <h4 className="heading-label acl-subheading">Approved users</h4>
                        <span className="acl-field-help">Add or remove the users who are allowed to join.</span>
                      </div>
                      <div className="acl-member-summary">
                        <span className="acl-member-count">{approvedMembers.length} approved user{approvedMembers.length === 1 ? '' : 's'}</span>
                        <span className="acl-field-help">These users are allowed to join this channel.</span>
                      </div>

                      {approvedMembers.length === 0 ? (
                        <div className="acl-empty-state">No approved users yet.</div>
                      ) : (
                        <div className="acl-user-list">
                          {approvedEntries.map(entry => {
                            const user = availableUsersBySession.get(entry.userId) ?? registeredUsers.find(registeredUser => registeredUser.id === entry.userId);
                            return (
                              <article key={`approved-${entry.userId}`} className="acl-user-card">
                                <div className="acl-user-card-header">
                                  <div>
                                    <strong>{user?.name ?? `User ${entry.userId}`}</strong>
                                    <div className="acl-field-help">{`User id ${entry.userId}`}</div>
                                  </div>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    type="button"
                                    disabled={interactionsDisabled}
                                    onClick={() => removeRule(entry.sourceRuleIndex, { persist: true })}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}

                      {approvedUserAddCandidates.length > 0 ? (
                        <div className="acl-group-add">
                          <label className="acl-field acl-group-add-field">
                            <span className="acl-field-label">Add approved user</span>
                            <Select
                              value={pendingApprovedSession}
                              onChange={setPendingApprovedSession}
                              disabled={interactionsDisabled}
                              options={approvedUserAddCandidates.map(user => ({ value: String(user.id), label: user.name }))}
                            />
                          </label>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={interactionsDisabled || !pendingApprovedSession}
                            onClick={() => {
                              const userId = Number.parseInt(pendingApprovedSession, 10);
                              if (!Number.isNaN(userId)) {
                                addOrUpdateDirectUserRule(userId, CHANNEL_ENTRY_PERMISSIONS, 0);
                              }
                            }}
                          >
                            Add User
                          </button>
                        </div>
                      ) : (
                        <div className="acl-empty-state">No other registered users are available to approve right now.</div>
                      )}
                    </div>
                  )}
                </section>

                <section className="acl-simple-card">
                  <div className="acl-pane-header">
                    <h3 className="heading-section settings-section-title">Password</h3>
                    <p className="acl-section-copy">Protect the channel with a password if you want an extra layer of access control.</p>
                  </div>
                  {isNativePasswordProtected && !passwordEntry && (
                    <div className="acl-warning">
                      <Icon name="alert-triangle" />
                      <div>
                        <strong>Native Mumble Password Detected</strong>
                        <p>This channel has a password set via the native Mumble client. Brmble can only manage passwords set through this interface. To use Brmble's password management, please remove the existing password using a Mumble client first, or enable password protection below to set a Brmble-managed password.</p>
                      </div>
                    </div>
                  )}
                  <ToggleControl
                    checked={passwordEnabled}
                    disabled={interactionsDisabled}
                    label="Password protected"
                    onChange={checked => {
                      if (checked) {
                        addPasswordRule();
                      } else if (passwordPending) {
                        setPasswordPending(false);
                        setPasswordInput(passwordEntryValue);
                      } else if (passwordEntry) {
                        removePasswordRule();
                      }
                    }}
                  />

                  {passwordEnabled && (
                    <div className="acl-simple-list">
                      <label className="acl-field">
                        <span className="acl-field-label">Password</span>
                        <span className={`acl-password-wrapper${passwordFocused || passwordToggleFocused ? ' focused' : ''}`}>
                          <input
                            className="brmble-input acl-password-input"
                            aria-label="Channel password selector"
                            type={showPassword ? 'text' : 'password'}
                            value={passwordInput}
                            disabled={interactionsDisabled}
                            onChange={e => setPasswordInput(e.target.value)}
                            onFocus={() => setPasswordFocused(true)}
                            onBlur={() => {
                              setPasswordFocused(false);
                              if (!passwordToggleFocused) setShowPassword(false);
                            }}
                          />
                          {!interactionsDisabled && (passwordFocused || passwordToggleFocused) && (
                            <button
                              type="button"
                              className="acl-password-toggle"
                              onMouseDown={e => { e.preventDefault(); setShowPassword(value => !value); }}
                              onFocus={() => setPasswordToggleFocused(true)}
                              onBlur={() => { setPasswordToggleFocused(false); setShowPassword(false); }}
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              aria-pressed={showPassword}
                            >
                              {showPassword ? (
                                <Icon name="eye-off" size={18} />
                              ) : (
                                <Icon name="eye" size={18} />
                              )}
                            </button>
                          )}
                        </span>
                      </label>
                      {showPasswordActions && (
                        <div className="acl-password-actions">
                          <button
                            className="btn btn-secondary acl-password-action"
                            type="button"
                            disabled={interactionsDisabled}
                            onClick={() => {
                              setPasswordInput(passwordEntryValue);
                              if (passwordPending) setPasswordPending(false);
                            }}
                            aria-label="Cancel password change"
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary acl-password-action"
                            type="button"
                            disabled={interactionsDisabled || !passwordCanSave}
                            onClick={() => savePassword(passwordInput)}
                            aria-label="Save password"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="acl-simple-card">
                  <div className="acl-pane-header">
                    <h3 className="heading-section settings-section-title">Moderators</h3>
                    <p className="acl-section-copy">Moderators can kick, ban, move, and mute users in this channel.</p>
                  </div>
                  <div className="acl-list-header">
                    <h4 className="heading-label acl-subheading">Moderator list</h4>
                    <span className="acl-field-help">Add or remove the users who should manage this channel.</span>
                  </div>
                  <div className="acl-member-summary">
                    <span className="acl-member-count">{moderatorMembers.length} moderator{moderatorMembers.length === 1 ? '' : 's'}</span>
                    <span className="acl-field-help">Pick the users who should manage this channel.</span>
                  </div>

                  {moderatorMembers.length === 0 ? (
                    <div className="acl-empty-state">No moderators yet.</div>
                  ) : (
                    <div className="acl-user-list">
                      {moderatorEntries.map(entry => {
                        const user = availableUsersBySession.get(entry.userId) ?? registeredUsers.find(registeredUser => registeredUser.id === entry.userId);
                        return (
                          <article key={`moderator-${entry.userId}`} className="acl-user-card">
                            <div className="acl-user-card-header">
                              <div>
                                <strong>{user?.name ?? `User ${entry.userId}`}</strong>
                                <div className="acl-field-help">{`User id ${entry.userId}`}</div>
                              </div>
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                disabled={interactionsDisabled}
                                onClick={() => removeRule(entry.sourceRuleIndex, { persist: true })}
                              >
                                Remove
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {moderatorAddCandidates.length > 0 ? (
                    <div className="acl-group-add">
                      <label className="acl-field acl-group-add-field">
                        <span className="acl-field-label">Add moderator</span>
                        <Select
                          value={pendingModeratorSession}
                          onChange={setPendingModeratorSession}
                          disabled={interactionsDisabled}
                          options={moderatorAddCandidates.map(user => ({ value: String(user.id), label: user.name }))}
                        />
                      </label>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={interactionsDisabled || !pendingModeratorSession}
                        onClick={() => {
                          const userId = Number.parseInt(pendingModeratorSession, 10);
                          if (!Number.isNaN(userId)) {
                            addOrUpdateDirectUserRule(userId, CHANNEL_ENTRY_PERMISSIONS | MODERATOR_PERMISSIONS, 0);
                          }
                        }}
                      >
                        Add Moderator
                      </button>
                    </div>
                  ) : (
                    <div className="acl-empty-state">No other registered users are available to add as moderators right now.</div>
                  )}
                </section>
              </div>
            </section>

            <section className="acl-section">
              <div className="acl-section-header">
                <h3 className="heading-section settings-section-title">Blocked users</h3>
                <p className="acl-section-copy">Blocked users cannot enter this channel, even if they would normally have access.</p>
              </div>
              {blockedUserEntries.length === 0 ? (
                <div className="acl-empty-state">No blocked users.</div>
              ) : (
                <div className="acl-user-list">
                  {blockedUserEntries.map(entry => (
                    <article key={`blocked-user-${entry.sourceRuleIndex}`} className="acl-user-card">
                      <div className="acl-user-card-header">
                        <div>
                          <strong>{availableUsersBySession.get(entry.userId)?.name ?? registeredUsers.find(user => user.id === entry.userId)?.name ?? `User ${entry.userId}`}</strong>
                          <div className="acl-field-help">{`User id ${entry.userId}`}</div>
                        </div>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={interactionsDisabled} onClick={() => removeRule(entry.sourceRuleIndex, { persist: true })}>
                          Unblock
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {blockedUserAddCandidates.length > 0 && (
                <div className="acl-group-add">
                  <label className="acl-field acl-group-add-field">
                    <span className="acl-field-label">Block user</span>
                    <Select
                      value={pendingBlockedSession}
                      onChange={setPendingBlockedSession}
                      disabled={interactionsDisabled}
                      options={blockedUserAddCandidates.map(user => ({ value: String(user.id), label: user.name }))}
                    />
                  </label>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={interactionsDisabled || !pendingBlockedSession}
                    onClick={() => {
                      const session = Number.parseInt(pendingBlockedSession, 10);
                      if (!Number.isNaN(session)) {
                        addBlockedUserRule(session);
                      }
                    }}
                  >
                    Block User
                  </button>
                </div>
              )}
            </section>

            {inheritedRules.length > 0 && (
              <section className="acl-section">
                <details className="acl-inherited">
                  <summary>{inheritedRules.length} inherited rules</summary>
                  <p className="acl-section-copy acl-section-copy--compact">Inherited rules are read-only here and come from the parent channel.</p>
                  {inheritedRules.map((rule, index) => (
                    <div className="acl-rule-row inherited" key={`inherited-${index}`}>
                      <span>{rule.group ?? `User ${rule.userId}`}</span>
                      <span>Allow {rule.allow}</span>
                      <span>Deny {rule.deny}</span>
                    </div>
                  ))}
                </details>
              </section>
            )}
          </>
        )}

        <div className="acl-editor-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" disabled={!canSave} onClick={() => draft && save(draft)}>
            {saving ? 'Saving...' : 'Save ACLs'}
          </button>
        </div>
      </div>
    </div>
  );
}
