import { useState } from 'react';
import './AdminSettingsTab.css';
import { ADMIN_WORKSPACE_TABS, type AdminWorkspaceTab } from './admin/AdminWorkspaceTypes';
import type { CompanionSelection } from './InterfaceSettingsTypes';
import { AdminModerationSection } from './admin/AdminModerationSection';
import { AdminChannelsSection } from './admin/AdminChannelsSection';
import { AdminChannelRequestsSection } from './admin/AdminChannelRequestsSection';
import { AdminUsersSection } from './admin/AdminUsersSection';
import { AdminAuditLogSection } from './admin/AdminAuditLogSection';
import { AdminGroupsSection } from './admin/AdminGroupsSection';
import type { CustomCompanionCapability } from '../../customCompanions/customCompanionTypes';
import type { CustomCompanionGalleryController } from '../../hooks/useCustomCompanionGallery';
import type { Channel } from '../../types';

interface AdminSettingsTabProps {
  channels?: Channel[];
  onChannelsChange?: (channels: Channel[]) => void;
  liveUsers?: Array<{
    session: number;
    name: string;
    channelId?: number;
    // Tri-state on the projection: null means the server has not said yet.
    matrixUserId?: string | null;
    companionId?: CompanionSelection | null;
    isBrmbleClient?: boolean | null;
  }>;
  customCompanions?: Pick<CustomCompanionCapability, 'canModerate'>;
  customCompanionGallery?: CustomCompanionGalleryController;
}

export function AdminSettingsTab({
  channels = [],
  onChannelsChange,
  liveUsers = [],
  customCompanions,
  customCompanionGallery,
}: AdminSettingsTabProps) {
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
        {activeTab === 'channels' && (
          <div className="admin-workspace-stack">
            <AdminChannelsSection channels={channels} onChannelsChange={onChannelsChange} />
            <AdminChannelRequestsSection />
          </div>
        )}
        {activeTab === 'users' && <AdminUsersSection liveUsers={liveUsers} />}
        {activeTab === 'groups' && <AdminGroupsSection />}
        {activeTab === 'moderation' && (
          <AdminModerationSection
            customCompanions={customCompanions}
            customCompanionGallery={customCompanionGallery}
          />
        )}
        {activeTab === 'audit-log' && <AdminAuditLogSection />}
      </div>
    </div>
  );
}
