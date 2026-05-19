import { useEffect, useMemo, useState } from 'react';
import { useAclAdmin } from '../../../hooks/useAclAdmin';
import type { AclGroup } from '../../../types/acl';

const DEFAULT_GROUPS: AclGroup[] = [
  { name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] },
  { name: 'Members', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] },
];

export function AdminGroupsSection() {
  const { snapshot, save } = useAclAdmin(0);
  const sourceGroups = useMemo(() => (snapshot?.groups?.length ? snapshot.groups : DEFAULT_GROUPS), [snapshot]);
  const [draftGroups, setDraftGroups] = useState<AclGroup[]>(sourceGroups);
  const [selectedGroupName, setSelectedGroupName] = useState(sourceGroups[0]?.name ?? '');

  useEffect(() => {
    setDraftGroups(sourceGroups);
    setSelectedGroupName(sourceGroups[0]?.name ?? '');
  }, [sourceGroups]);

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
    setDraftGroups(next);
    setSelectedGroupName(name);
  };

  const deleteGroup = () => {
    if (!selectedGroupName) return;
    const next = draftGroups.filter(group => group.name !== selectedGroupName);
    setDraftGroups(next);
    setSelectedGroupName(next[0]?.name ?? '');
  };

  const cancelChanges = () => {
    setDraftGroups(sourceGroups);
    setSelectedGroupName(sourceGroups[0]?.name ?? '');
  };

  const saveChanges = () => {
    const payload = {
      inheritAcls: snapshot?.inheritAcls ?? true,
      groups: draftGroups,
      acls: snapshot?.acls ?? [],
    };
    save(payload);
  };

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Groups</h3>
      </div>
      <div className="admin-groups-layout">
        <div className="admin-card">
          <h4 className="heading-label">Groups List</h4>
          <div className="admin-table-placeholder">
            {draftGroups.map(group => (
              <button
                key={group.name}
                type="button"
                className={`admin-channel-row ${group.name === selectedGroupName ? 'selected' : ''}`}
                onClick={() => setSelectedGroupName(group.name)}
              >
                {group.name}
              </button>
            ))}
          </div>
          <div className="admin-action-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addGroup}>Add Group</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={deleteGroup} disabled={!selectedGroupName}>Delete Group</button>
          </div>
        </div>
        <div className="admin-card">
          <h4 className="heading-label">Members</h4>
          <div className="admin-empty">Available users and transfer actions render here.</div>
        </div>
      </div>
      <div className="admin-card">
        <h4 className="heading-label">Group Permissions</h4>
        <div className="admin-empty">Permission checklists by category render here.</div>
      </div>
      <div className="admin-footer-row">
        <button type="button" className="btn btn-secondary" onClick={cancelChanges}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={saveChanges}>Save Changes</button>
      </div>
    </section>
  );
}
