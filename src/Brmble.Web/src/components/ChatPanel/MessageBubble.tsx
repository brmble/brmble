import './MessageBubble.css';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
  isSystem?: boolean;
  html?: boolean;
}

export function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html }: MessageBubbleProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const classes = ['message-bubble'];
  if (isOwnMessage) classes.push('own');
  if (isSystem) classes.push('message-bubble--system');

  return (
    <div className={classes.join(' ')}>
      <div className="message-avatar">
        <span className="avatar-letter">{getAvatarLetter(sender)}</span>
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-sender">{sender}</span>
          <span className="message-time">{formatTime(timestamp)}</span>
        </div>
        {html ? (
          <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
        ) : (
          <p className="message-text">{content}</p>
        )}
      </div>
    </div>
  );
}
