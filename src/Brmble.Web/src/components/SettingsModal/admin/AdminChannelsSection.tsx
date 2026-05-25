import { useEffect, useMemo, useState } from 'react';
import { prompt } from '../../../hooks/usePrompt';
import bridge from '../../../bridge';
import type { Channel } from '../../../types';
import { ContextMenu } from '../../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu';
import { EditChannelDialog } from '../../EditChannelDialog/EditChannelDialog';
import { AclEditorDialog } from '../../AclEditor/AclEditorDialog';
import { sortChannelsByMumbleOrder } from '../../../utils/channelOrdering';

const REQUESTS = [{ id: 1, requestedBy: 'Mike', channelName: 'Officer Chat', status: 'Pending' }];

interface AdminChannelsSectionProps {
  channels?: Channel[];
}

export function AdminChannelsSection({ channels = [] }: AdminChannelsSectionProps) {
  const orderedChannels = useMemo(() => sortChannelsByMumbleOrder(channels), [channels]);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(orderedChannels[0]?.id ?? null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channelId: number } | null>(null);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [permissionsChannel, setPermissionsChannel] = useState<Channel | null>(null);
  const contextChannel = orderedChannels.find(channel => channel.id === contextMenu?.channelId) ?? null;

  useEffect(() => {
    if (selectedChannelId != null && orderedChannels.some(channel => channel.id === selectedChannelId)) {
      return;
    }

    setSelectedChannelId(orderedChannels[0]?.id ?? null);
  }, [orderedChannels, selectedChannelId]);

  const handleDeleteChannel = async (channel: Channel) => {
    const result = await prompt({
      title: 'Delete Channel',
      message: `Type "${channel.name}" to confirm deleting this channel.`,
      placeholder: channel.name,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });

    if (result !== channel.name) return;
    bridge.send('voice.removeChannel', { channelId: channel.id });
  };

  const menuItems: ContextMenuItem[] = contextChannel ? [
    { type: 'item', label: 'Edit Channel', onClick: () => setEditChannel(contextChannel) },
    { type: 'item', label: 'Edit Permissions', onClick: () => setPermissionsChannel(contextChannel) },
    { type: 'item', label: 'Delete Channel', onClick: () => void handleDeleteChannel(contextChannel) },
  ] : [];

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Channels</h3>
      </div>

      <div className="admin-card">
        <h4 className="heading-label">Existing Channels</h4>
        <div className="admin-table-placeholder" role="table" aria-label="Existing Channels table">
          {orderedChannels.length > 0 ? (
            orderedChannels.map(channel => (
              <button
                key={channel.id}
                type="button"
                className={`admin-channel-row ${channel.id === selectedChannelId ? 'selected' : ''}`}
                role="row"
                aria-label={channel.name}
                onClick={() => setSelectedChannelId(channel.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedChannelId(channel.id);
                  setContextMenu({ x: e.clientX, y: e.clientY, channelId: channel.id });
                }}
              >
                {channel.name}
              </button>
            ))
          ) : (
            <p className="admin-help-text">No channels are available yet.</p>
          )}
        </div>
      </div>

      <div className="admin-card">
        <h4 className="heading-label">Channel Requests</h4>
        <div className="admin-table-placeholder">
          {REQUESTS.map(request => (
            <div key={request.id} className="admin-request-row">
              <span>{request.requestedBy} requested {request.channelName}</span>
              <div className="admin-request-status-cell">
                <span className="admin-request-status">{request.status}</span>
                <div className="admin-request-actions">
                  <button type="button" className="btn btn-secondary btn-sm" aria-label={`Approve ${request.requestedBy} request`}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" aria-label={`Deny ${request.requestedBy} request`}>
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-action-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled>Create Channel</button>
      </div>

      <p className="admin-help-text">Create Channel is not available yet. Right-click a channel for admin actions.</p>
      {contextMenu && menuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {editChannel && (
        <EditChannelDialog
          isOpen={true}
          initialName={editChannel.name}
          initialDescription={editChannel.description}
          initialPosition={editChannel.position ?? 0}
          initialPassword=""
          showPosition
          onClose={() => setEditChannel(null)}
          onSave={(name, description, position) => {
            bridge.send('admin.updateChannel', {
              channelId: editChannel.id,
              name,
              description,
              position,
            });
            setEditChannel(null);
          }}
        />
      )}
      {permissionsChannel && (
        <AclEditorDialog
          isOpen={true}
          channelId={permissionsChannel.id}
          channelName={permissionsChannel.name}
          availableUsers={[]}
          isNativePasswordProtected={permissionsChannel.isEnterRestricted ?? false}
          onClose={() => setPermissionsChannel(null)}
        />
      )}
    </section>
  );
}
