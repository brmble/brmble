import { useState, forwardRef, type ReactNode } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MediaAttachment } from '../../types';
import { extractFirstUrl } from '../../hooks/useLinkPreview';
import { linkifyText } from '../../utils/linkifyText';
import { mentionifyText } from '../../utils/mentionifyText';
import { ImageAttachment } from './ImageAttachment';
import { ImageLightbox } from './ImageLightbox';
import { LinkPreview } from './LinkPreview';
import Avatar from '../Avatar/Avatar';
import './MessageBubble.css';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
  isSystem?: boolean;
  html?: boolean;
  media?: MediaAttachment[];
  matrixClient?: MatrixClient | null;
  collapsed?: boolean;
  searchQuery?: string;
  isActiveMatch?: boolean;
  messageIndex?: number;
  senderAvatarUrl?: string;
  senderMatrixUserId?: string;
  currentUsername?: string;
  knownUsernames?: Set<string>;
  messageId?: string;
  pending?: boolean;
  error?: boolean;
  replyToEventId?: string;
  replyToSender?: string;
  replyToContent?: string;
  onDismiss?: (messageId: string) => void;
  onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
}

/** Highlight search matches within a plain-text string, returning React nodes. */
function highlightString(text: string, query: string): ReactNode[] {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(<mark key={idx} className="search-highlight">{text.slice(idx, idx + query.length)}</mark>);
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/**
 * Linkify text first, then apply search highlighting to non-link text segments.
 * This preserves clickable URLs while still highlighting search matches.
 */
function linkifyAndHighlight(text: string, query: string): ReactNode {
  if (!query) return linkifyText(text);

  const linkified = linkifyText(text);

  // If linkifyText returned a plain string, just highlight it
  if (typeof linkified === 'string') {
    const parts = highlightString(linkified, query);
    return parts.length > 0 ? parts : linkified;
  }

  // linkifyText returned an array of nodes — highlight only string segments
  if (Array.isArray(linkified)) {
    return linkified.map((node, i) => {
      if (typeof node === 'string') {
        const parts = highlightString(node, query);
        return parts.length > 0 ? <span key={`hl-${i}`}>{parts}</span> : node;
      }
      // It's a React element (link) — leave it as-is
      return node;
    });
  }

  return linkified;
}

function highlightHtml(html: string, query: string): string {
  if (!query) return html;
  const lowerQuery = query.toLowerCase();
  // Split on HTML tags to only highlight text nodes
  return html.replace(/([^<]+)(?=<|$)/g, (textNode) => {
    const lowerText = textNode.toLowerCase();
    let result = '';
    let lastIndex = 0;
    let idx = lowerText.indexOf(lowerQuery, lastIndex);
    while (idx !== -1) {
      result += textNode.slice(lastIndex, idx);
      result += `<mark class="search-highlight">${textNode.slice(idx, idx + query.length)}</mark>`;
      lastIndex = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, lastIndex);
    }
    result += textNode.slice(lastIndex);
    return result;
  });
}

/**
 * Process message content: mentionify, then linkify+highlight remaining text.
 */
function processMessageContent(
  text: string,
  knownUsernames: Set<string> | undefined,
  currentUsername: string | undefined,
  searchQuery: string,
): ReactNode {
  if (!knownUsernames || knownUsernames.size === 0) {
    return linkifyAndHighlight(text, searchQuery);
  }

  const mentionified = mentionifyText(text, knownUsernames, currentUsername);

  // If no mentions found, fall through to linkify
  if (typeof mentionified === 'string') {
    return linkifyAndHighlight(mentionified, searchQuery);
  }

  // mentionifyText returned an array — linkify only string segments
  if (Array.isArray(mentionified)) {
    return mentionified.map((node, i) => {
      if (typeof node === 'string') {
        const result = linkifyAndHighlight(node, searchQuery);
        return typeof result === 'string' ? result : <span key={`lh-${i}`}>{result}</span>;
      }
      return node; // Already a React element (mention span)
    });
  }

  return mentionified;
}

export const MessageBubble = forwardRef<HTMLDivElement, MessageBubbleProps & React.HTMLAttributes<HTMLDivElement>>(function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html, media, matrixClient, collapsed, searchQuery, isActiveMatch, messageIndex, senderAvatarUrl, senderMatrixUserId, currentUsername, knownUsernames, messageId, pending, error, replyToEventId, replyToSender, replyToContent, onDismiss, onOpenContextMenu, className, ...rest }, ref) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const classes = ['message-bubble'];
  if (isOwnMessage) classes.push('own');
  if (isSystem) classes.push('message-bubble--system');
  if (collapsed) classes.push('message-bubble--collapsed');
  if (isActiveMatch) classes.push('search-active-match');
  if (pending) classes.push('message-bubble--pending');
  if (error) classes.push('message-bubble--error');
  if (className) classes.push(className);

  const firstUrl = (!isSystem && content) ? extractFirstUrl(content) : null;

  return (
    <div ref={ref} className={classes.join(' ')} data-message-index={messageIndex} {...rest} onContextMenu={(e) => {
  if (onOpenContextMenu) {
    e.preventDefault();
    onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId, content, messageId);
  }
}}>
      {collapsed ? (
        <div className="message-gutter">
          <span className="message-hover-time">{formatTime(timestamp)}</span>
        </div>
      ) : (
        <div className="message-avatar">
          <Avatar user={{ name: sender, matrixUserId: senderMatrixUserId, avatarUrl: senderAvatarUrl }} size={48} isMumbleOnly={!isOwnMessage && !senderMatrixUserId} />
        </div>
      )}
      <div className="message-content">
        {!collapsed && (
          <div className="message-header">
            <span className="message-sender">{sender}</span>
            <span className="message-time">{formatTime(timestamp)}</span>
          </div>
        )}
        {replyToEventId && (replyToSender || replyToContent) && (
          <div className="message-reply-preview">
            <span className="message-reply-sender">{replyToSender}</span>
            <span className="message-reply-content">{replyToContent}</span>
          </div>
        )}
        {content && (
          html ? (
            <div className="message-text" dangerouslySetInnerHTML={{ __html: searchQuery ? highlightHtml(content, searchQuery) : content }} />
          ) : (
            <p className="message-text">
              {processMessageContent(content, knownUsernames, currentUsername, searchQuery || '')}
            </p>
          )
        )}
        {media && media.length > 0 && (
          <div className="message-media">
            {media.map((attachment, i) => (
              <ImageAttachment
                key={i}
                attachment={attachment}
                onOpenLightbox={setLightboxUrl}
              />
            ))}
          </div>
        )}
        {firstUrl && matrixClient && (
          <LinkPreview url={firstUrl} client={matrixClient} />
        )}
        {error && messageId && (
          <div className="message-error-overlay">
            <span className="message-error-text">Failed to send</span>
            <div className="message-error-actions">
              {onDismiss && (
                <button
                  className="message-error-btn message-error-dismiss"
                  onClick={() => onDismiss(messageId)}
                  aria-label="Dismiss failed message"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
});
