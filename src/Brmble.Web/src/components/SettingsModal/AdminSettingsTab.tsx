import { useState } from 'react';
import './AdminSettingsTab.css';
import { ADMIN_WORKSPACE_TABS, type AdminWorkspaceTab } from './admin/AdminWorkspaceTypes';
import { AdminModerationSection } from './admin/AdminModerationSection';
import { AdminChannelsSection } from './admin/AdminChannelsSection';
import { AdminUsersSection } from './admin/AdminUsersSection';
import { AdminAuditLogSection } from './admin/AdminAuditLogSection';
import { AdminGroupsSection } from './admin/AdminGroupsSection';
import type { Channel } from '../../types';

interface AdminSettingsTabProps {
  channels?: Channel[];
  liveUsers?: Array<{
    session: number;
    name: string;
    channelId?: number;
    matrixUserId?: string;
    companionId?: string;
    isBrmbleClient?: boolean;
  }>;
}

export function AdminSettingsTab({ channels = [], liveUsers = [] }: AdminSettingsTabProps) {
  const [activeTab, setActiveTab] = useState<AdminWorkspaceTab>('channels');

  return (
    <div className="admin-settings-tab">
      <div className="settings-subtabs" role="tablist" aria-label="Admin sections">
        {ADMIN_WORKSPACE_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`settings-subtab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="admin-workspace-body">
        {activeTab === 'channels' && <AdminChannelsSection channels={channels} />}
        {activeTab === 'users' && <AdminUsersSection liveUsers={liveUsers} />}
        {activeTab === 'groups' && <AdminGroupsSection channels={channels} />}
        {activeTab === 'moderation' && <AdminModerationSection />}
        {activeTab === 'audit-log' && <AdminAuditLogSection />}
      </div>
    </div>
  );
}
