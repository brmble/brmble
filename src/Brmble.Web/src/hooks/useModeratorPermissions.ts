import { useState, useEffect, useCallback } from 'react';
import bridge from '../bridge';

export interface ModeratorRole {
  id: string;
  name: string;
  permissions: number;
}

export interface ModeratorAssignment {
  id: string;
  userId: number;
  roleId: string;
  roleName: string;
  rolePermissions: number;
  assignedAt: string;
}

export const ModeratorPermission = {
  Kick: 0x001,
  DenyEnter: 0x002,
  RenameChannel: 0x004,
  SetPassword: 0x008,
  EditDesc: 0x010,
} as const;

export function useModeratorPermissions(channelId: number | null) {
  const [roles, setRoles] = useState<ModeratorRole[]>([]);
  const [moderators, setModerators] = useState<ModeratorAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserPermissions, setCurrentUserPermissions] = useState<number>(0);

  const loadRoles = useCallback(() => {
    bridge.send('moderator.getRoles');
  }, []);

  const loadModerators = useCallback((chId: number) => {
    setLoading(true);
    bridge.send('moderator.getChannelModerators', { channelId: chId });
  }, []);

  const createRole = useCallback((name: string, permissions: number) => {
    bridge.send('moderator.createRole', { name, permissions });
  }, []);

  const updateRole = useCallback((id: string, name?: string, permissions?: number) => {
    bridge.send('moderator.updateRole', { id, name, permissions });
  }, []);

  const deleteRole = useCallback((id: string) => {
    bridge.send('moderator.deleteRole', { id });
  }, []);

  const assignModerator = useCallback((roleId: string, userId: number) => {
    if (channelId === null) return;
    bridge.send('moderator.assign', { channelId, roleId, userId });
  }, [channelId]);

  const removeModerator = useCallback((assignmentId: string) => {
    if (channelId === null) return;
    bridge.send('moderator.remove', { channelId, assignmentId });
  }, [channelId]);

  useEffect(() => {
    const handleRoles = (data: unknown) => {
      setRoles(data as ModeratorRole[]);
    };

    const handleModerators = (data: unknown) => {
      setModerators(data as ModeratorAssignment[]);
      setLoading(false);
    };

    const handleCurrentUserPermissions = (data: unknown) => {
      const payload = data as { channelId: number; permissions: number };
      if (channelId !== null && payload.channelId === channelId) {
        setCurrentUserPermissions(payload.permissions);
      }
    };

    const handleRoleCreated = () => loadRoles();
    const handleRoleUpdated = () => loadRoles();
    const handleRoleDeleted = () => loadRoles();
    const handleAssigned = () => {
      if (channelId !== null) loadModerators(channelId);
    };
    const handleRemoved = () => {
      if (channelId !== null) loadModerators(channelId);
    };

    bridge.on('moderator.roles', handleRoles);
    bridge.on('moderator.channelModerators', handleModerators);
    bridge.on('moderator.currentUserPermissions', handleCurrentUserPermissions);
    bridge.on('moderator.roleCreated', handleRoleCreated);
    bridge.on('moderator.roleUpdated', handleRoleUpdated);
    bridge.on('moderator.roleDeleted', handleRoleDeleted);
    bridge.on('moderator.assigned', handleAssigned);
    bridge.on('moderator.removed', handleRemoved);

    loadRoles();

    return () => {
      bridge.off('moderator.roles', handleRoles);
      bridge.off('moderator.channelModerators', handleModerators);
      bridge.off('moderator.currentUserPermissions', handleCurrentUserPermissions);
      bridge.off('moderator.roleCreated', handleRoleCreated);
      bridge.off('moderator.roleUpdated', handleRoleUpdated);
      bridge.off('moderator.roleDeleted', handleRoleDeleted);
      bridge.off('moderator.assigned', handleAssigned);
      bridge.off('moderator.removed', handleRemoved);
    };
  }, [loadRoles]);

  useEffect(() => {
    if (channelId !== null) {
      loadModerators(channelId);
      bridge.send('moderator.getCurrentUserPermissions', { channelId });
    }
  }, [channelId, loadModerators]);

  const hasPermission = useCallback((permission: number): boolean => {
    return (currentUserPermissions & permission) !== 0;
  }, [currentUserPermissions]);

  const hasAnyModeratorRole = currentUserPermissions > 0;

  return {
    roles,
    moderators,
    loading,
    currentUserPermissions,
    hasPermission,
    hasAnyModeratorRole,
    loadRoles,
    loadModerators,
    createRole,
    updateRole,
    deleteRole,
    assignModerator,
    removeModerator,
  };
}
