import { useState } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
import './DMContactList.css';

interface DMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: number;
  comment?: string;
}

interface DMContactListProps {
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (userId: string, userName: string) => void;
  onCloseConversation: (userId: string) => void;
  onlineUserIds: string[];
  visible: boolean;
}

export type { DMContact };

export function DMContactList({ contacts, selectedUserId, onSelectContact, onCloseConversation, onlineUserIds, visible }: DMContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{ userId: string; userName: string } | null>(null);

  const filtered = contacts.filter(c =>
    c.userName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (date?: Date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
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
            key={contact.userId}
            className={`dm-contact-entry ${selectedUserId === contact.userId ? 'active' : ''}`}
            onClick={() => onSelectContact(contact.userId, contact.userName)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, userId: contact.userId, userName: contact.userName });
            }}
          >
            <div className="dm-contact-avatar">
              <span>{contact.userName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="dm-contact-info">
              <div className="dm-contact-name-row">
                <Tooltip content={contact.comment || ''}>
                <span className="dm-contact-name">{contact.userName}</span>
                </Tooltip>
                {contact.lastMessageTime && (
                  <span className="dm-contact-time">{formatTime(contact.lastMessageTime)}</span>
                )}
              </div>
              {contact.lastMessage && (
                <span className="dm-contact-preview">{contact.lastMessage}</span>
              )}
            </div>
            {contact.unread > 0 && (
              <span className="dm-contact-unread">{contact.unread}</span>
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
              label: 'User Information',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              disabled: !onlineUserIds.includes(contextMenu.userId),
              onClick: () => { setInfoDialogUser({ userId: contextMenu.userId, userName: contextMenu.userName }); setContextMenu(null); },
            },
            {
              label: 'Close Conversation',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ),
              onClick: () => { onCloseConversation(contextMenu.userId); setContextMenu(null); },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {infoDialogUser && (
        <UserInfoDialog
          isOpen={true}
          onClose={() => setInfoDialogUser(null)}
          userName={infoDialogUser.userName}
          session={parseInt(infoDialogUser.userId)}
          isSelf={false}
          comment={contacts.find(c => c.userId === infoDialogUser.userId)?.comment}
        />
      )}
    </div>
  );
}
