import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import { groupMessages } from '../../utils/groupMessages';
import { formatDateSeparator, formatFullDate } from '../../utils/formatDateSeparator';
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

const SCROLL_THRESHOLD = 150;

export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, isDM, matrixClient }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldShow = distanceFromBottom > SCROLL_THRESHOLD;
    setShowScrollButton(prev => prev !== shouldShow ? shouldShow : prev);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const checkScrollButton = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      setShowScrollButton(false);
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollButton(distanceFromBottom > SCROLL_THRESHOLD);
  }, []);

  // Re-evaluate scroll button when the messages container resizes
  // (e.g. when the DM/channel slide becomes visible).
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => checkScrollButton());
    observer.observe(container);
    return () => observer.disconnect();
  }, [checkScrollButton]);

  // Re-evaluate scroll button visibility when switching channels or messages change.
  // Uses requestAnimationFrame so the DOM has rendered the new messages
  // before we measure scrollHeight.
  useEffect(() => {
    const rafId = requestAnimationFrame(checkScrollButton);
    return () => cancelAnimationFrame(rafId);
  }, [channelId, messages, checkScrollButton]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Only auto-scroll if user is within threshold of bottom
    if (distanceFromBottom < SCROLL_THRESHOLD) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  if (!channelId) {
    return (
      <div className="chat-panel chat-panel--empty">
        <div className="chat-empty-state">
          {isDM ? (
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
          ) : (
            <div className="empty-logo">
              <BrmbleLogo size={192} heartbeat />
            </div>
          )}
          <h2 className="heading-title">{isDM ? 'Direct Messages' : 'Welcome to Brmble'}</h2>
          <p>{isDM ? 'Right-click a user in the channel tree to start a conversation' : 'Select a channel to start chatting'}</p>
        </div>
      </div>
    );
  }

  const userCount = 1; // Placeholder

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
                <div className="chat-date-separator" title={formatFullDate(item.message.timestamp)}>
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

      <div className="chat-input-area">
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
        <MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />
      </div>
    </div>
  );
}
