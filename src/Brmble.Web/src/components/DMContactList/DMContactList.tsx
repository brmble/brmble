import { useState } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
import { Icon } from '../Icon/Icon';
import Avatar from '../Avatar/Avatar';
import type { DMContact } from '../../hooks/useDMStore';
import './DMContactList.css';

interface DMContactListProps {
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (id: string, displayName: string) => void;
  onCloseConversation: (id: string) => void;
  onlineUserIds: string[];
  visible: boolean;
}

export function DMContactList({ contacts, selectedUserId, onSelectContact, onCloseConversation, onlineUserIds, visible }: DMContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; displayName: string; isEphemeral?: boolean } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{ id: string; displayName: string } | null>(null);

  const filtered = contacts.filter(c =>
    c.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div className={`dm-contact-list ${visible ? 'visible' : ''}`}>
      <div className="dm-contact-list-header">
        <h3 className="heading-section">Messages</h3>
      </div>

      <div className="dm-contact-search">
        <Icon name="search" size={14} />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="dm-contact-search-input"
        />
      </div>

      <div className="dm-contact-entries">
        {filtered.length === 0 && (
          <p className="dm-contact-empty">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
        {filtered.map(contact => (
          <button
            key={contact.id}
            className={`dm-contact-entry ${selectedUserId === contact.id ? 'active' : ''} ${contact.isEphemeral && contact.mumbleSessionId == null ? 'offline' : ''}`}
            onClick={() => onSelectContact(contact.id, contact.displayName)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, id: contact.id, displayName: contact.displayName, isEphemeral: contact.isEphemeral });
            }}
          >
            <Avatar user={{ name: contact.displayName, matrixUserId: contact.isEphemeral ? undefined : contact.id, avatarUrl: contact.avatarUrl }} size={28} isMumbleOnly={contact.isEphemeral} />
            <div className="dm-contact-info">
              <div className="dm-contact-name-row">
                <Tooltip content="">
                <span className="dm-contact-name">
                  {contact.displayName}
                </span>
                </Tooltip>
                {contact.isEphemeral && (
                  <span className="dm-contact-ephemeral-tag">mumble</span>
                )}
                {contact.lastMessageTime && (
                  <span className="dm-contact-time">{formatTime(contact.lastMessageTime)}</span>
                )}
              </div>
              {contact.lastMessage && (
                <span className="dm-contact-preview">{contact.lastMessage}</span>
              )}
            </div>
            {contact.unreadCount > 0 && (
              <span className="dm-contact-unread">{contact.unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              type: 'item' as const,
              label: 'Send Direct Message',
              icon: (
                <Icon name="message-square" size={14} />
              ),
              onClick: () => { onSelectContact(contextMenu.id, contextMenu.displayName); setContextMenu(null); },
            },
            {
              type: 'item' as const,
              label: 'User Information',
              icon: (
                <Icon name="info-filled" size={14} />
              ),
              disabled: !onlineUserIds.includes(contextMenu.id),
              onClick: () => { setInfoDialogUser({ id: contextMenu.id, displayName: contextMenu.displayName }); setContextMenu(null); },
            },
            // Only Mumble (ephemeral) contacts can be closed — Brmble DMs are persistent
            ...(contextMenu.isEphemeral ? [{
              type: 'item' as const,
              label: 'Close Conversation',
              icon: (
                <Icon name="x" size={14} />
              ),
              onClick: () => { onCloseConversation(contextMenu.id); setContextMenu(null); },
            }] : []),
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {infoDialogUser && (() => {
        const contact = contacts.find(c => c.id === infoDialogUser.id);
        return (
        <UserInfoDialog
          isOpen={true}
          onClose={() => setInfoDialogUser(null)}
          userName={infoDialogUser.displayName}
          session={0}
          isSelf={false}
          comment={undefined}
          matrixUserId={contact?.id}
          avatarUrl={contact?.avatarUrl}
          onStartDM={(userId, userName) => onSelectContact(userId, userName)}
        />
        );
      })()}
    </div>
  );
}
