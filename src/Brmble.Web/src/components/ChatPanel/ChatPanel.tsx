import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { groupMessages } from '../../utils/groupMessages';
import { formatDateSeparator } from '../../utils/formatDateSeparator';
import type { ChatMessage } from '../../types';
import './ChatPanel.css';

interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string) => void;
  isDM?: boolean;
  matrixClient?: MatrixClient | null;
}

export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, isDM, matrixClient }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Only auto-scroll if user is within 150px of bottom
    if (distanceFromBottom < 150) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (!channelId) {
    return (
      <div className="chat-panel chat-panel--empty">
        <div className="chat-empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {isDM ? (
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              ) : (
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              )}
            </svg>
          </div>
          <h2 className="heading-title">{isDM ? 'Direct Messages' : 'Welcome to Brmble'}</h2>
          <p>{isDM ? 'Right-click a user in the channel tree to start a conversation' : 'Select a channel to start chatting'}</p>
        </div>
      </div>
    );
  }

  const userCount = 1; // Placeholder
  const grouped = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-left">
          {isDM ? (
            <div className="dm-chat-avatar">
              <span>{channelName?.charAt(0).toUpperCase()}</span>
            </div>
          ) : (
            <span className="channel-hash">#</span>
          )}
          <h3 className="heading-section">{channelName}</h3>
        </div>
        {!isDM && (
          <div className="chat-header-right">
            <span className="user-count-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{userCount}</span>
            </span>
          </div>
        )}
      </div>

      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
        {grouped.length === 0 ? (
          <div className="chat-no-messages">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          grouped.map((item) => (
            <Fragment key={item.message.id}>
              {item.showDateSeparator && (
                <div className="chat-date-separator">
                  <span className="chat-date-separator-label">
                    {formatDateSeparator(item.message.timestamp)}
                  </span>
                </div>
              )}
              <MessageBubble
                sender={item.message.sender}
                content={item.message.content}
                timestamp={item.message.timestamp}
                isOwnMessage={!item.message.type && item.message.sender === currentUsername}
                isSystem={item.message.type === 'system'}
                collapsed={!item.isGroupStart}
                html={item.message.html}
                media={item.message.media}
                matrixClient={matrixClient}
              />
            </Fragment>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />

      {showScrollButton && (
        <button
          className="chat-scroll-bottom"
          onClick={scrollToBottom}
          title="Scroll to bottom"
          aria-label="Scroll to latest messages"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
}
