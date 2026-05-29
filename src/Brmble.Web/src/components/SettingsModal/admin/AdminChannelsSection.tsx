import { useEffect, useRef, useState } from 'react';
import '../AdminSettingsTab.css';
import { AclEditorDialog } from '../../../components/AclEditor/AclEditorDialog';
import bridge from '../../../bridge';
import { prompt } from '../../../hooks/usePrompt';
import type { Channel } from '../../../types';
import { ContextMenu } from '../../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu';
import { EditChannelDialog } from '../../EditChannelDialog/EditChannelDialog';
import { SettingsHelp } from '../SettingsHelp';
import {
  buildReorderPayload,
  canDropIntoSiblingGroup,
  getOrderedChannels,
  moveChannelToSiblingIndex,
} from '../../../utils/channelOrder';

interface AdminChannelsSectionProps {
  channels?: Channel[];
  onChannelsChange?: (channels: Channel[]) => void;
}

export function AdminChannelsSection({ channels = [], onChannelsChange }: AdminChannelsSectionProps) {
  const [draftChannels, setDraftChannels] = useState<Channel[]>(() => getOrderedChannels(channels));
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(channels[0]?.id ?? null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channelId: number } | null>(null);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [permissionsChannel, setPermissionsChannel] = useState<Channel | null>(null);
  const [draggedChannelId, setDraggedChannelId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [recentlyMovedChannelId, setRecentlyMovedChannelId] = useState<number | null>(null);
  const recentlyMovedTimeoutRef = useRef<number | null>(null);
  const contextChannel = draftChannels.find(channel => channel.id === contextMenu?.channelId) ?? null;
  const orderedChannels = getOrderedChannels(draftChannels);

  useEffect(() => {
    if (selectedChannelId != null && orderedChannels.some(channel => channel.id === selectedChannelId)) {
      return;
    }

    setSelectedChannelId(orderedChannels[0]?.id ?? null);
  }, [orderedChannels, selectedChannelId]);

  useEffect(() => {
    setDraftChannels(getOrderedChannels(channels));
  }, [channels]);

  useEffect(() => () => {
    if (recentlyMovedTimeoutRef.current != null) {
      window.clearTimeout(recentlyMovedTimeoutRef.current);
    }
  }, []);

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
            orderedChannels.map(channel => {
              const isSelected = channel.id === selectedChannelId;
              const isDragging = channel.id === draggedChannelId;
              const isDropTarget = channel.id === dropTargetId;
              const isRecentlyMoved = channel.id === recentlyMovedChannelId;

              return (
                <div
                  key={channel.id}
                  className={[
                    'admin-channel-row',
                    isSelected ? 'selected' : '',
                    isDragging ? 'admin-channel-row--dragging' : '',
                    isDropTarget ? 'admin-channel-row--drop-target' : '',
                    isRecentlyMoved ? 'admin-channel-row--recently-moved' : '',
                  ].filter(Boolean).join(' ')}
                  role="row"
                  aria-label={`${channel.name} Position ${channel.position ?? 0}`}
                  tabIndex={0}
                  draggable={channel.id !== 0}
                  onClick={() => setSelectedChannelId(channel.id)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') {
                      return;
                    }

                    event.preventDefault();
                    setSelectedChannelId(channel.id);
                  }}
                  onDragStart={event => {
                    setRecentlyMovedChannelId(null);
                    setDraggedChannelId(channel.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(channel.id));
                  }}
                  onDragEnd={() => {
                    setDraggedChannelId(null);
                    setDropTargetId(null);
                  }}
                  onDragOver={event => {
                    if (draggedChannelId == null || !canDropIntoSiblingGroup(draggedChannelId, channel.id, draftChannels)) {
                      return;
                    }

                    event.preventDefault();
                    setDropTargetId(channel.id);
                  }}
                  onDragLeave={() => {
                    if (dropTargetId === channel.id) {
                      setDropTargetId(null);
                    }
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    if (draggedChannelId == null) {
                      return;
                    }

                    const movedChannelId = draggedChannelId;
                    const nextChannels = moveChannelToSiblingIndex(draftChannels, movedChannelId, channel.id);
                    if (nextChannels === draftChannels) {
                      setDraggedChannelId(null);
                      setDropTargetId(null);
                      return;
                    }

                    const moved = nextChannels.find(candidate => candidate.id === movedChannelId);
                    const payload = buildReorderPayload(nextChannels, moved?.parent ?? 0);
                    setDraftChannels(nextChannels);
                    onChannelsChange?.(nextChannels);
                    setRecentlyMovedChannelId(movedChannelId);
                    if (recentlyMovedTimeoutRef.current != null) {
                      window.clearTimeout(recentlyMovedTimeoutRef.current);
                    }
                    recentlyMovedTimeoutRef.current = window.setTimeout(() => {
                      setRecentlyMovedChannelId(current => (current === movedChannelId ? null : current));
                      recentlyMovedTimeoutRef.current = null;
                    }, 1200);
                    payload.channelIds.forEach((chId, i) => {
                      const ch = nextChannels.find(c => c.id === chId);
                      if (ch) {
                        bridge.send('admin.updateChannel', {
                          channelId: chId,
                          name: ch.name,
                          description: ch.description ?? '',
                          position: payload.positions[i],
                        });
                      }
                    });
                    setDraggedChannelId(null);
                    setDropTargetId(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelectedChannelId(channel.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, channelId: channel.id });
                  }}
                >
                  <span className="admin-channel-row-name">{channel.name}</span>
                  <span className="admin-channel-position-pill">Position {channel.position ?? 0}</span>
                </div>
              );
            })
          ) : (
            <p className="admin-help-text">No channels are available yet.</p>
          )}
        </div>
      </div>

      <div className="admin-action-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled>Create Channel</button>
        <SettingsHelp content="Right-click a channel for admin actions." label="More information about channel admin actions" />
      </div>

      <p className="admin-help-text">Create Channel is not available yet. Request actions and safe delete are available.</p>
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
          onSave={(name, description, position, _password) => {
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
