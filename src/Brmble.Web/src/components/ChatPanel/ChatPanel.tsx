import { useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import type { ChatMessage } from '../../types';
import './ChatPanel.css';

interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string) => void;
  isDM?: boolean;
}

export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, isDM }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          <h3>{isDM ? 'Direct Messages' : 'Welcome to Brmble'}</h3>
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
          <h2 className="channel-title">{channelName}</h2>
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

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-no-messages">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map(message => (
            <MessageBubble
              key={message.id}
              sender={message.sender}
              content={message.content}
              timestamp={message.timestamp}
              isOwnMessage={!message.type && message.sender === currentUsername}
              isSystem={message.type === 'system'}
              html={message.html}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />
    </div>
  );
}
