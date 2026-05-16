import { useEffect, useMemo, useState } from 'react';
import type { AclRule, AclUpdateRequest } from '../../types/acl';
import { Permission } from '../../types/acl';
import { useAclAdmin } from '../../hooks/useAclAdmin';
import { Icon } from '../Icon/Icon';
import './AclEditorDialog.css';

type AclDraft = Omit<AclUpdateRequest, 'expectedSnapshotHash'>;

interface AclEditorDialogProps {
  channelId: number;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
}

const permissionRows = [
  ['Enter', Permission.Enter],
  ['Traverse', Permission.Traverse],
  ['Speak', Permission.Speak],
  ['Text', Permission.TextMessage],
  ['Write', Permission.Write],
] as const;

export function AclEditorDialog({ channelId, channelName, isOpen, onClose }: AclEditorDialogProps) {
  const { snapshot, loading, saving, error, refresh, save } = useAclAdmin(isOpen ? channelId : null);
  const [draft, setDraft] = useState<AclDraft | null>(null);
  const visibleSnapshotRules = useMemo(
    () => snapshot?.acls.filter(rule => !rule.group?.startsWith('__brmble_password_marker__:')) ?? [],
    [snapshot],
  );

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!snapshot) return;
    setDraft({
      inheritAcls: snapshot.inheritAcls,
      groups: snapshot.groups,
      acls: visibleSnapshotRules,
    });
  }, [snapshot, visibleSnapshotRules]);

  if (!isOpen) return null;

  const addTokenRule = () => {
    setDraft(current => {
      const base = current ?? { inheritAcls: true, groups: [], acls: [] };
      const rule: AclRule = {
        applyHere: true,
        applySubs: false,
        inherited: false,
        userId: null,
        group: '#token',
        allow: Permission.Enter | Permission.Traverse,
        deny: 0,
      };
      return { ...base, acls: [...base.acls, rule] };
    });
  };

  const updateRule = (index: number, patch: Partial<AclRule>) => {
    setDraft(current => {
      if (!current) return current;
      const acls = current.acls.map((rule, i) => i === index ? { ...rule, ...patch } : rule);
      return { ...current, acls };
    });
  };

  const removeRule = (index: number) => {
    setDraft(current => {
      if (!current) return current;
      return {
        ...current,
        acls: current.acls.filter((_, i) => i !== index),
      };
    });
  };

  const localRules = draft?.acls
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !rule.inherited) ?? [];
  const inheritedRules = draft?.acls.filter(rule => rule.inherited) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="acl-editor glass-panel animate-slide-up" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <button className="modal-close acl-editor-close" type="button" onClick={onClose} aria-label="Close ACL editor">
          <Icon name="x" size={20} />
        </button>

        <div className="modal-header acl-editor-header">
          <h2 className="heading-title modal-title">Permissions for {channelName}</h2>
          <p className="modal-subtitle">Rules save to Mumble and refresh from the server&apos;s canonical ACL state.</p>
        </div>

        {loading && <div className="acl-banner">Loading ACL state...</div>}
        {error && <div className="acl-banner acl-banner-warning">{error}</div>}
        {snapshot?.stale && <div className="acl-banner acl-banner-warning">Cached ACL state is stale. Refresh before editing.</div>}

        {draft && (
          <>
            <section className="acl-section">
              <div className="acl-section-header">
                <h3 className="heading-section settings-section-title">Defaults</h3>
              </div>

              <label className="acl-toggle">
                <input
                  type="checkbox"
                  checked={draft.inheritAcls}
                  onChange={e => setDraft({ ...draft, inheritAcls: e.target.checked })}
                />
                <span>Inherit ACLs from the parent channel</span>
              </label>
            </section>

            <section className="acl-section">
              <div className="acl-section-header acl-section-header--split">
                <div>
                  <h3 className="heading-section settings-section-title">Local Rules</h3>
                  <p className="acl-section-copy">Use token or user selectors, then choose where each rule applies.</p>
                </div>
                <div className="acl-toolbar">
                  <button className="btn btn-secondary" type="button" onClick={addTokenRule}>Add Token Rule</button>
                  <button className="btn btn-secondary" type="button" onClick={refresh} disabled={loading || saving}>Refresh</button>
                </div>
              </div>

              {localRules.length === 0 ? (
                <div className="acl-empty-state">
                  No local rules yet. Add a token rule to grant channel access without editing inherited permissions.
                </div>
              ) : (
                <div className="acl-rule-list">
                  {localRules.map(({ rule, index }) => (
                    <div className="acl-rule-row" key={`${rule.group ?? rule.userId}-${index}`}>
                      <div className="acl-rule-main">
                        <label className="acl-field">
                          <span className="acl-field-label">Selector</span>
                          <input
                            className="brmble-input"
                            value={rule.userId == null ? rule.group ?? '' : String(rule.userId)}
                            onChange={e => {
                              if (rule.userId != null) {
                                const nextUserId = Number.parseInt(e.target.value, 10);
                                updateRule(index, { userId: Number.isNaN(nextUserId) ? null : nextUserId, group: null });
                                return;
                              }

                              updateRule(index, { group: e.target.value, userId: null });
                            }}
                            aria-label="Selector"
                          />
                        </label>

                        <div className="acl-scope">
                          <span className="acl-field-label">Applies To</span>
                          <label><input type="checkbox" checked={rule.applyHere} onChange={e => updateRule(index, { applyHere: e.target.checked })} /> Here</label>
                          <label><input type="checkbox" checked={rule.applySubs} onChange={e => updateRule(index, { applySubs: e.target.checked })} /> Subchannels</label>
                        </div>
                      </div>

                      <div className="acl-rule-actions">
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeRule(index)}>Remove</button>
                      </div>

                      <div className="acl-permissions">
                        {permissionRows.map(([label, bit]) => (
                          <label key={label}>
                            <input
                              type="checkbox"
                              checked={(rule.allow & bit) !== 0}
                              onChange={e => updateRule(index, { allow: e.target.checked ? rule.allow | bit : rule.allow & ~bit })}
                            />
                            Allow {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
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
          <button className="btn btn-primary" type="button" disabled={!draft || saving || snapshot?.stale} onClick={() => draft && save(draft)}>
            {saving ? 'Saving...' : 'Save ACLs'}
          </button>
        </div>
      </div>
    </div>
  );
}
