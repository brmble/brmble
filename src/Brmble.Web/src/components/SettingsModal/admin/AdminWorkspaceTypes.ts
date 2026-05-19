export type AdminWorkspaceTab = 'channels' | 'users' | 'groups' | 'moderation' | 'audit-log';

export interface AdminWorkspaceTabDefinition {
  id: AdminWorkspaceTab;
  label: string;
}

export const ADMIN_WORKSPACE_TABS: AdminWorkspaceTabDefinition[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'users', label: 'Users' },
  { id: 'groups', label: 'Groups' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'audit-log', label: 'Audit Log' },
];
