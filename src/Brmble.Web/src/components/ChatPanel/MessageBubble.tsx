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
import { Tooltip } from '../Tooltip/Tooltip';
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
  mumbleDelivery?: 'too-large';
  replyToEventId?: string;
  replyToSender?: string;
  replyToContent?: string;
  isReplyTargetHighlighted?: boolean;
  onReplyClick?: (eventId: string) => void;
  onDismiss?: (messageId: string) => void;
  onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string, msgType?: string, reactions?: Record<string, string[]>, redacted?: boolean) => void;
  reactions?: Record<string, string[]>;
  redacted?: boolean;
  currentUserMatrixId?: string;
  onToggleReaction?: (messageId: string, emoji: string, isReacted: boolean) => void;
  edited?: boolean;
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

export const MessageBubble = forwardRef<HTMLDivElement, MessageBubbleProps & React.HTMLAttributes<HTMLDivElement>>(function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html, media, matrixClient, collapsed, searchQuery, isActiveMatch, messageIndex, senderAvatarUrl, senderMatrixUserId, currentUsername, knownUsernames, messageId, pending, error, mumbleDelivery, replyToEventId, replyToSender, replyToContent, isReplyTargetHighlighted, onReplyClick, onDismiss, onOpenContextMenu, className, reactions, redacted, currentUserMatrixId, onToggleReaction, edited, ...rest }, ref) {
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
  if (isReplyTargetHighlighted) classes.push('message-bubble--reply-target');
  if (redacted) classes.push('message-bubble--redacted');
  if (className) classes.push(className);

  // Show placeholder for redacted messages instead of hiding them
  if (redacted) {
    return (
      <div ref={ref} className={classes.join(' ')} data-message-index={messageIndex} {...rest}>
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
          <div className="message-text message-text--deleted">
            Message deleted
          </div>
        </div>
      </div>
    );
  }

  const firstUrl = (!isSystem && content) ? extractFirstUrl(content) : null;
  const hasReplyPreview = Boolean(replyToEventId && (replyToSender || replyToContent));
  const canJumpToReply = Boolean(hasReplyPreview && replyToEventId && onReplyClick);
  const replyPreviewLabel = `Jump to replied message from ${replyToSender ?? 'unknown sender'}: ${replyToContent ?? 'empty message'}`;

  const handleReplyActivation = () => {
    if (replyToEventId) {
      onReplyClick?.(replyToEventId);
    }
  };

  return (
    <div ref={ref} className={classes.join(' ')} data-message-index={messageIndex} {...rest} onContextMenu={(e) => {
  if (onOpenContextMenu) {
    e.preventDefault();
    onOpenContextMenu(e.clientX, e.clientY, sender, senderMatrixUserId, content, messageId, undefined, reactions, redacted);
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
            <span className="message-time">
              {formatTime(timestamp)}
              {edited ? ' (edited)' : ''}
            </span>
          </div>
        )}
        {hasReplyPreview && (
          canJumpToReply ? (
            <button
              type="button"
              className="message-reply-preview message-reply-preview--interactive"
              onClick={handleReplyActivation}
              aria-label={replyPreviewLabel}
            >
              <span className="message-reply-sender">{replyToSender}</span>
              <span className="message-reply-content">{replyToContent}</span>
            </button>
          ) : (
            <div className="message-reply-preview">
              <span className="message-reply-sender">{replyToSender}</span>
              <span className="message-reply-content">{replyToContent}</span>
            </div>
          )
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
        {mumbleDelivery === 'too-large' && media && media.length > 0 && (
          <div className="message-mumble-delivery">
            <Tooltip content="Image is too large to send to the Mumble client.">
              <span
                className="message-mumble-delivery-indicator"
                aria-label="Image was not sent to the Mumble client"
              >
                <span className="message-mumble-delivery-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" focusable="false">
                    <path d="M8 1.5a5.5 5.5 0 0 1 4.48 8.69l1.96 1.96-.94.94-9-9 .94-.94 1.49 1.49A5.48 5.48 0 0 1 8 1.5Zm0 11a5.48 5.48 0 0 1-3.79-1.51l1-1A4.1 4.1 0 0 0 8 10.9a4.1 4.1 0 0 0 1.72-.38l1.03 1.03A5.47 5.47 0 0 1 8 12.5Zm2.55-3.23A4.1 4.1 0 0 0 8 5.1c-.46 0-.9.08-1.31.22l3.86 3.95Z" fill="currentColor" />
                  </svg>
                </span>
              </span>
            </Tooltip>
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
                  className="btn btn-secondary btn-sm message-error-btn message-error-dismiss"
                  onClick={() => onDismiss(messageId)}
                  aria-label="Dismiss failed message"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}
        {reactions && messageId && Object.entries(reactions).length > 0 && (
          <div className="message-reactions">
            {Object.entries(reactions).map(([emoji, senders]) => {
              const isReacted = currentUserMatrixId ? senders.includes(currentUserMatrixId) : false;
              return (
                <Tooltip key={emoji} content={`${senders.length} reaction${senders.length === 1 ? '' : 's'}`}>
                  <button
                    className={`reaction-badge${isReacted ? ' reacted' : ''}`}
                    onClick={() => onToggleReaction?.(messageId, emoji, isReacted)}
                    aria-label={`${emoji} ${senders.length}`}
                  >
                    <span className="reaction-emoji">{emoji}</span>
                    <span className="reaction-count">{senders.length}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
});
