import { useState } from 'react';
import { useModeratorPermissions, ModeratorPermission } from '../../hooks/useModeratorPermissions';
import { confirm } from '../../hooks/usePrompt';
import './ManageModeratorsTab.css';

interface ManageModeratorsTabProps {
  channelId: number;
  isAdmin: boolean;
  connectedUsers?: { session: number; name: string; userId?: number }[];
}

export function ManageModeratorsTab({ channelId, isAdmin, connectedUsers = [] }: ManageModeratorsTabProps) {
  const {
    roles,
    moderators,
    loading,
    hasAnyModeratorRole,
    createRole,
    updateRole,
    deleteRole,
    removeModerator,
  } = useModeratorPermissions(channelId);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<{ id: string; name: string; permissions: number } | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const handleAddModerator = () => {
    setSelectedUserId(null);
    setShowUserModal(true);
  };

  const handleConfirmAddModerator = () => {
    if (!selectedUserId) return;
    console.log('[ManageModeratorsTab] Selected user:', selectedUserId);
    setShowUserModal(false);
  };

  const handleRemoveModerator = async (assignmentId: string, userId: number) => {
    const confirmed = await confirm({
      title: 'Remove Moderator',
      message: `Remove moderator (User ID: ${userId}) from this channel?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    removeModerator(assignmentId);
  };

  const handleCreateRole = () => {
    setEditingRole(null);
    setShowRoleModal(true);
  };

  const handleEditRole = (role: { id: string; name: string; permissions: number }) => {
    setEditingRole(role);
    setShowRoleModal(true);
  };

  const handleSaveRole = (name: string, permissions: number) => {
    if (editingRole) {
      updateRole(editingRole.id, name, permissions);
    } else {
      createRole(name, permissions);
    }
    setShowRoleModal(false);
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    const confirmed = await confirm({
      title: 'Delete Role',
      message: `Delete role "${roleName}"? This will remove all assignments using this role.`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    deleteRole(roleId);
  };

  const getPermissionLabel = (perm: number): string => {
    switch (perm) {
      case ModeratorPermission.Kick: return 'Kick';
      case ModeratorPermission.DenyEnter: return 'Deny Enter';
      case ModeratorPermission.RenameChannel: return 'Rename Channel';
      case ModeratorPermission.SetPassword: return 'Set Password';
      case ModeratorPermission.EditDesc: return 'Edit Description';
      default: return 'Unknown';
    }
  };

  const renderPermission = (perm: number, checked: boolean) => (
    <span key={perm} className={`permission-badge ${checked ? 'granted' : ''}`}>
      {checked ? '✓' : '✗'} {getPermissionLabel(perm)}
    </span>
  );

  const canEdit = isAdmin;
  const allPermissions = [
    ModeratorPermission.Kick,
    ModeratorPermission.DenyEnter,
    ModeratorPermission.RenameChannel,
    ModeratorPermission.SetPassword,
    ModeratorPermission.EditDesc,
  ];

  return (
    <div className="manage-moderators-tab">
      {!canEdit && !hasAnyModeratorRole && (
        <div className="moderator-view-only-banner">
          View only — Contact an admin to modify moderator settings.
        </div>
      )}

      {!canEdit && hasAnyModeratorRole && (
        <div className="moderator-view-banner">
          You are a moderator of this channel.
        </div>
      )}

      <div className="moderators-section">
        <div className="section-header">
          <h4 className="heading-label">Channel Moderators</h4>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={handleAddModerator}>
              Add Moderator
            </button>
          )}
        </div>

        {loading && <div className="loading">Loading...</div>}

        {!loading && moderators.length === 0 && (
          <div className="empty-state">No moderators assigned to this channel.</div>
        )}

        {!loading && moderators.length > 0 && (
          <div className="moderator-list">
            {moderators.map(mod => (
              <div key={mod.id} className="moderator-row">
                <div className="moderator-info">
                  <span className="moderator-user-id">User #{mod.userId}</span>
                  <span className="moderator-role-name">{mod.roleName}</span>
                  <div className="moderator-permissions">
                    {allPermissions.map(perm =>
                      renderPermission(perm, (mod.rolePermissions & perm) !== 0)
                    )}
                  </div>
                </div>
                {canEdit && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleRemoveModerator(mod.id, mod.userId)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="roles-section">
          <div className="section-header">
            <h4 className="heading-label">Moderator Roles</h4>
            <button className="btn btn-secondary btn-sm" onClick={handleCreateRole}>
              Create Role
            </button>
          </div>

          {roles.length === 0 && (
            <div className="empty-state">No roles defined. Create one to get started.</div>
          )}

          {roles.length > 0 && (
            <div className="role-list">
              {roles.map(role => (
                <div key={role.id} className="role-row">
                  <div className="role-info">
                    <span className="role-name">{role.name}</span>
                    <div className="role-permissions">
                      {allPermissions.map(perm =>
                        renderPermission(perm, (role.permissions & perm) !== 0)
                      )}
                    </div>
                  </div>
                  <div className="role-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEditRole(role)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteRole(role.id, role.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRoleModal && (
        <ModeratorRoleModal
          role={editingRole}
          onSave={handleSaveRole}
          onClose={() => setShowRoleModal(false)}
        />
      )}

      {showUserModal && (
        <AddModeratorModal
          users={connectedUsers}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          onConfirm={handleConfirmAddModerator}
          onClose={() => setShowUserModal(false)}
        />
      )}
    </div>
  );
}

interface ModeratorRoleModalProps {
  role: { id: string; name: string; permissions: number } | null;
  onSave: (name: string, permissions: number) => void;
  onClose: () => void;
}

function ModeratorRoleModal({ role, onSave, onClose }: ModeratorRoleModalProps) {
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState(role?.permissions ?? 0);

  const togglePermission = (perm: number) => {
    setPermissions(prev => prev ^ perm);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name, permissions);
  };

  const permissionItems = [
    { perm: ModeratorPermission.Kick, label: 'Kick users from channel' },
    { perm: ModeratorPermission.DenyEnter, label: 'Deny user from entering channel' },
    { perm: ModeratorPermission.RenameChannel, label: 'Rename channel' },
    { perm: ModeratorPermission.SetPassword, label: 'Set/change channel password' },
    { perm: ModeratorPermission.EditDesc, label: 'Edit channel description' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prompt glass-panel animate-slide-up role-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">
            {role ? 'Edit Role' : 'Create Role'}
          </h2>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Role Name</label>
            <input
              type="text"
              className="brmble-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter role name..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Permissions</label>
            <div className="permission-checkboxes">
              {permissionItems.map(({ perm, label }) => (
                <div key={perm} className="permission-checkbox">
                  <label>{label}</label>
                  <label className="brmble-toggle">
                    <input
                      type="checkbox"
                      checked={(permissions & perm) !== 0}
                      onChange={() => togglePermission(perm)}
                    />
                    <span className="brmble-toggle-slider"></span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddModeratorModalProps {
  users: { session: number; name: string; userId?: number }[];
  selectedUserId: number | null;
  onSelectUser: (userId: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function AddModeratorModal({
  users,
  selectedUserId,
  onSelectUser,
  onConfirm,
  onClose,
}: AddModeratorModalProps) {
  const usersWithId = users.filter(u => u.userId !== undefined);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prompt glass-panel animate-slide-up add-user-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Select User</h2>
        </div>

        <div className="modal-body">
          <div className="form-group">
            {usersWithId.length === 0 ? (
              <div className="empty-state">No registered users currently connected.</div>
            ) : (
              <div className="user-list">
                {usersWithId.map(user => (
                  <div
                    key={user.session}
                    className={`user-item ${selectedUserId === user.userId ? 'selected' : ''}`}
                    onClick={() => onSelectUser(user.userId!)}
                  >
                    <span className="user-name">{user.name}</span>
                    <span className="user-id">#{user.userId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={!selectedUserId}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
