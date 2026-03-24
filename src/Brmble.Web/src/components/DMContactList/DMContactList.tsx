import { useState } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; displayName: string } | null>(null);
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
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
              setContextMenu({ x: e.clientX, y: e.clientY, id: contact.id, displayName: contact.displayName });
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
              label: 'Send Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => { onSelectContact(contextMenu.id, contextMenu.displayName); setContextMenu(null); },
            },
            {
              label: 'User Information',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              disabled: !onlineUserIds.includes(contextMenu.id),
              onClick: () => { setInfoDialogUser({ id: contextMenu.id, displayName: contextMenu.displayName }); setContextMenu(null); },
            },
            {
              label: 'Close Conversation',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ),
              onClick: () => { onCloseConversation(contextMenu.id); setContextMenu(null); },
            },
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
