import { useState } from 'react';
import './DMContactList.css';

interface DMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: number;
}

interface DMContactListProps {
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (userId: string, userName: string) => void;
  visible: boolean;
}

export type { DMContact };

export function DMContactList({ contacts, selectedUserId, onSelectContact, visible }: DMContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');

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
          >
            <div className="dm-contact-avatar">
              <span>{contact.userName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="dm-contact-info">
              <div className="dm-contact-name-row">
                <span className="dm-contact-name">{contact.userName}</span>
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
    </div>
  );
}
