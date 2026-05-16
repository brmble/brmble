import { useEffect, useState } from 'react';
import type { AclRule, AclUpdateRequest } from '../../types/acl';
import { Permission } from '../../types/acl';
import { useAclAdmin } from '../../hooks/useAclAdmin';
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

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!snapshot) return;
    setDraft({
      inheritAcls: snapshot.inheritAcls,
      groups: snapshot.groups,
      acls: snapshot.acls,
    });
  }, [snapshot]);

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

  const localRules = draft?.acls.filter(rule => !rule.inherited) ?? [];
  const inheritedRules = draft?.acls.filter(rule => rule.inherited) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="acl-editor glass-panel animate-slide-up" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="acl-editor-header">
          <div>
            <h2 className="heading-title">Permissions for {channelName}</h2>
            <p>Rules are saved to Mumble, then refreshed from canonical server state.</p>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {loading && <div className="acl-banner">Loading ACL state...</div>}
        {error && <div className="acl-banner acl-banner-warning">{error}</div>}
        {snapshot?.stale && <div className="acl-banner acl-banner-warning">Cached ACL state is stale. Refresh before editing.</div>}

        {draft && (
          <>
            <label className="acl-toggle">
              <input
                type="checkbox"
                checked={draft.inheritAcls}
                onChange={e => setDraft({ ...draft, inheritAcls: e.target.checked })}
              />
              Inherit ACLs from parent channel
            </label>

            <div className="acl-toolbar">
              <button className="btn btn-secondary" type="button" onClick={addTokenRule}>Add Token Rule</button>
              <button className="btn btn-secondary" type="button" onClick={refresh} disabled={loading || saving}>Refresh</button>
            </div>

            <div className="acl-rule-list">
              {localRules.map((rule, index) => (
                <div className="acl-rule-row" key={`${rule.group ?? rule.userId}-${index}`}>
                  <input
                    className="brmble-input"
                    value={rule.userId == null ? rule.group ?? '' : String(rule.userId)}
                    onChange={e => updateRule(index, { group: e.target.value, userId: null })}
                    aria-label="Selector"
                  />
                  <label><input type="checkbox" checked={rule.applyHere} onChange={e => updateRule(index, { applyHere: e.target.checked })} /> Here</label>
                  <label><input type="checkbox" checked={rule.applySubs} onChange={e => updateRule(index, { applySubs: e.target.checked })} /> Subs</label>
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

            {inheritedRules.length > 0 && (
              <details className="acl-inherited">
                <summary>{inheritedRules.length} inherited rules</summary>
                {inheritedRules.map((rule, index) => (
                  <div className="acl-rule-row inherited" key={`inherited-${index}`}>
                    <span>{rule.group ?? `User ${rule.userId}`}</span>
                    <span>allow {rule.allow}</span>
                    <span>deny {rule.deny}</span>
                  </div>
                ))}
              </details>
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
