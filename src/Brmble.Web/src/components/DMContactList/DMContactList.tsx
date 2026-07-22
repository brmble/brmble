import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  onToggleVisibility: () => void;
  visible: boolean;
}

export function DMContactList({ contacts, selectedUserId, onSelectContact, onCloseConversation, onToggleVisibility, visible }: DMContactListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [othersExpanded, setOthersExpanded] = useState(() =>
    localStorage.getItem('dm-others-expanded') === 'true'
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: string;
    displayName: string;
    isEphemeral?: boolean;
    mumbleSessionId?: number | null;
    onlineSessionId?: number;
  } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{
    id: string;
    displayName: string;
    isEphemeral?: boolean;
    mumbleSessionId?: number | null;
    onlineSessionId?: number;
  } | null>(null);

  useEffect(() => {
    if (!visible) setContextMenu(null);
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible && contentRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
  }, [visible]);

  const filtered = contacts.filter(c =>
    c.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const messageContacts = filtered.filter(c => !c.isEphemeral);
  const mumbleContacts = filtered.filter(c => c.isEphemeral);
  const conversationContacts = messageContacts.filter(c => c.lastMessageTime != null);
  const otherContacts = messageContacts.filter(c => c.lastMessageTime == null);
  const hasOtherContacts = contacts.some(c => !c.isEphemeral && c.lastMessageTime == null);
  const isSearchActive = searchQuery.length > 0;
  const showOtherContacts = othersExpanded || isSearchActive;

  const handleToggleVisibility = () => {
    if (visible && contentRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
    onToggleVisibility();
  };

  const handleToggleOthers = () => {
    setOthersExpanded((current) => {
      const next = !current;
      localStorage.setItem('dm-others-expanded', String(next));
      return next;
    });
  };

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
      <div className={`dm-contact-list-header ${visible ? '' : 'collapsed'}`}>
        <button
          type="button"
          ref={toggleRef}
          className="dm-contact-list-toggle"
          onClick={handleToggleVisibility}
          aria-label={visible ? 'Collapse Messages panel' : 'Expand Messages panel'}
        >
          <Icon name={visible ? 'chevron-right' : 'chevron-left'} size={18} />
        </button>
        <h3 className="heading-section">Messages</h3>
      </div>
      <div ref={contentRef} className="dm-contact-list-content" aria-hidden={!visible} inert={!visible}>

      <div className="dm-contact-search">
        <Icon name="search" size={14} />
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="dm-contact-search-input"
        />
      </div>

      <div className="dm-contact-entries">
        {filtered.length === 0 && (
          <p className="dm-contact-empty">
            {searchQuery ? 'No matching users' : 'No conversations yet'}
          </p>
        )}

        {conversationContacts.length > 0 && (
          <div className="dm-contact-section">
            {conversationContacts.map(contact => (
              <ContactEntry
                key={contact.id}
                contact={contact}
                selected={selectedUserId === contact.id}
                formatTime={formatTime}
                showUnread={visible}
                onSelectContact={onSelectContact}
                onOpenContextMenu={setContextMenu}
              />
            ))}
          </div>
        )}

        {hasOtherContacts && otherContacts.length > 0 && (
          <div className="dm-contact-section">
            <button
              type="button"
              className="dm-contact-section-toggle"
              onClick={handleToggleOthers}
              aria-expanded={showOtherContacts}
            >
              <Icon name={showOtherContacts ? 'chevron-down' : 'chevron-right'} size={14} />
              <span>Others</span>
            </button>
            {showOtherContacts && otherContacts.map(contact => (
              <ContactEntry
                key={contact.id}
                contact={contact}
                selected={selectedUserId === contact.id}
                formatTime={formatTime}
                showUnread={visible}
                onSelectContact={onSelectContact}
                onOpenContextMenu={setContextMenu}
              />
            ))}
          </div>
        )}

        {(mumbleContacts.length > 0 || (!searchQuery && messageContacts.length > 0)) && (
          <div className="dm-contact-section">
            <div className="dm-contact-section-title">Mumble users</div>
            {mumbleContacts.length === 0 ? (
              <p className="dm-contact-empty dm-contact-empty-section">No Mumble users online</p>
            ) : (
              mumbleContacts.map(contact => (
                <ContactEntry
                  key={contact.id}
                  contact={contact}
                  selected={selectedUserId === contact.id}
                  formatTime={formatTime}
                  showUnread={visible}
                  onSelectContact={onSelectContact}
                  onOpenContextMenu={setContextMenu}
                />
              ))
            )}
          </div>
        )}
      </div>
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
              disabled: contextMenu.isEphemeral
                ? contextMenu.mumbleSessionId == null
                : contextMenu.onlineSessionId == null,
              onClick: () => {
                setInfoDialogUser({
                  id: contextMenu.id,
                  displayName: contextMenu.displayName,
                  isEphemeral: contextMenu.isEphemeral,
                  mumbleSessionId: contextMenu.mumbleSessionId,
                  onlineSessionId: contextMenu.onlineSessionId,
                });
                setContextMenu(null);
              },
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
        const isEphemeral = contact?.isEphemeral ?? infoDialogUser.isEphemeral;
        const activeSession = isEphemeral
          ? contact?.mumbleSessionId
          : contact?.onlineSessionId;
        if (activeSession == null) return null;
        return (
        <UserInfoDialog
          isOpen={true}
          onClose={() => setInfoDialogUser(null)}
          userName={contact?.displayName ?? infoDialogUser.displayName}
          session={activeSession}
          isSelf={false}
          comment={undefined}
          matrixUserId={isEphemeral ? undefined : contact?.id}
          avatarUrl={contact?.avatarUrl}
          onStartDM={(_userId, userName) => onSelectContact(infoDialogUser.id, userName)}
        />
        );
      })()}
    </div>
  );
}

interface ContactEntryProps {
  contact: DMContact;
  selected: boolean;
  formatTime: (ts?: number) => string;
  showUnread: boolean;
  onSelectContact: (id: string, displayName: string) => void;
  onOpenContextMenu: (menu: {
    x: number;
    y: number;
    id: string;
    displayName: string;
    isEphemeral?: boolean;
    mumbleSessionId?: number | null;
    onlineSessionId?: number;
  }) => void;
}

function ContactEntry({ contact, selected, formatTime, showUnread, onSelectContact, onOpenContextMenu }: ContactEntryProps) {
  return (
    <button
      className={`dm-contact-entry ${selected ? 'active' : ''} ${contact.isEphemeral && contact.mumbleSessionId == null ? 'offline' : ''}`}
      onClick={() => onSelectContact(contact.id, contact.displayName)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContextMenu({
          x: e.clientX,
          y: e.clientY,
          id: contact.id,
          displayName: contact.displayName,
          isEphemeral: contact.isEphemeral,
          mumbleSessionId: contact.mumbleSessionId,
          onlineSessionId: contact.onlineSessionId,
        });
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
      {showUnread && contact.unreadCount > 0 && (
        <span className="dm-contact-unread">{contact.unreadCount}</span>
      )}
    </button>
  );
}
