import { useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MediaAttachment } from '../../types';
import { extractFirstUrl } from '../../hooks/useLinkPreview';
import { linkifyText } from '../../utils/linkifyText';
import { ImageAttachment } from './ImageAttachment';
import { ImageLightbox } from './ImageLightbox';
import { LinkPreview } from './LinkPreview';
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
}

export function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html, media, matrixClient, collapsed }: MessageBubbleProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const classes = ['message-bubble'];
  if (isOwnMessage) classes.push('own');
  if (isSystem) classes.push('message-bubble--system');
  if (collapsed) classes.push('message-bubble--collapsed');

  const firstUrl = (!isSystem && content) ? extractFirstUrl(content) : null;

  return (
    <div className={classes.join(' ')}>
      {collapsed ? (
        <div className="message-gutter">
          <span className="message-hover-time">{formatTime(timestamp)}</span>
        </div>
      ) : (
        <div className="message-avatar">
          <span className="avatar-letter">{getAvatarLetter(sender)}</span>
        </div>
      )}
      <div className="message-content">
        {!collapsed && (
          <div className="message-header">
            <span className="message-sender">{sender}</span>
            <span className="message-time">{formatTime(timestamp)}</span>
          </div>
        )}
        {content && (
          html ? (
            <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <p className="message-text">{linkifyText(content)}</p>
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
      </div>
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}
