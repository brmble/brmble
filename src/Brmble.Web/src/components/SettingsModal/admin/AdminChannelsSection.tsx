import { useEffect, useRef, useState } from 'react';
import '../AdminSettingsTab.css';
import { AclEditorDialog } from '../../../components/AclEditor/AclEditorDialog';
import bridge from '../../../bridge';
import { prompt } from '../../../hooks/usePrompt';
import type { Channel } from '../../../types';
import {
  buildReorderPayload,
  canDropIntoSiblingGroup,
  getOrderedChannels,
  moveChannelToSiblingIndex,
} from '../../../utils/channelOrder';

const REQUESTS = [{ id: 1, requestedBy: 'Mike', channelName: 'Officer Chat', status: 'Pending' }];

interface AdminChannelsSectionProps {
  channels?: Channel[];
  onChannelsChange?: (channels: Channel[]) => void;
}

export function AdminChannelsSection({ channels = [], onChannelsChange }: AdminChannelsSectionProps) {
  const [draftChannels, setDraftChannels] = useState<Channel[]>(() => getOrderedChannels(channels));
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(channels[0]?.id ?? null);
  const [aclEditorChannel, setAclEditorChannel] = useState<{ id: number; name: string } | null>(null);
  const [draggedChannelId, setDraggedChannelId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [recentlyMovedChannelId, setRecentlyMovedChannelId] = useState<number | null>(null);
  const recentlyMovedTimeoutRef = useRef<number | null>(null);
  const selectedChannel = draftChannels.find(channel => channel.id === selectedChannelId) ?? null;
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

  const handleDeleteChannel = async () => {
    if (!selectedChannel) return;

    const result = await prompt({
      title: 'Delete Channel',
      message: `Type "${selectedChannel.name}" to confirm deleting this channel.`,
      placeholder: selectedChannel.name,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });

    if (result !== selectedChannel.name) return;
    bridge.send('voice.removeChannel', { channelId: selectedChannel.id });
  };

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
                    'admin-channel-row--management',
                    isSelected ? 'selected' : '',
                    isDragging ? 'admin-channel-row--dragging' : '',
                    isDropTarget ? 'admin-channel-row--drop-target' : '',
                    isRecentlyMoved ? 'admin-channel-row--recently-moved' : '',
                  ].filter(Boolean).join(' ')}
                  role="row"
                  aria-label={channel.name}
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
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(channel.id));
                    }
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
                    payload.channelIds.forEach((channelId, index) => {
                      const reorderedChannel = nextChannels.find(candidate => candidate.id === channelId);
                      if (!reorderedChannel) {
                        return;
                      }

                      bridge.send('admin.updateChannel', {
                        channelId,
                        name: reorderedChannel.name,
                        description: reorderedChannel.description ?? '',
                        position: payload.positions[index],
                      });
                    });
                    setDraggedChannelId(null);
                    setDropTargetId(null);
                  }}
                >
                  <span>{channel.name}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label={`Edit ${channel.name}`}
                    onClick={event => {
                      event.stopPropagation();
                      setSelectedChannelId(channel.id);
                      setAclEditorChannel({ id: channel.id, name: channel.name });
                    }}
                  >
                    Edit
                  </button>
                </div>
              );
            })
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
        <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteChannel} disabled={!selectedChannel}>Delete Channel</button>
      </div>

      <p className="admin-help-text">Create Channel is not available yet. Request actions and safe delete are available.</p>
      {aclEditorChannel && (
        <AclEditorDialog
          isOpen={true}
          channelId={aclEditorChannel.id}
          channelName={aclEditorChannel.name}
          availableUsers={[]}
          isNativePasswordProtected={channels.find(channel => channel.id === aclEditorChannel.id)?.isEnterRestricted ?? false}
          onClose={() => setAclEditorChannel(null)}
        />
      )}
    </section>
  );
}
