import './MessageBubble.css';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
}

export function MessageBubble({ sender, content, timestamp, isOwnMessage }: MessageBubbleProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <div className={`message-bubble ${isOwnMessage ? 'own' : ''}`}>
      <div className="message-avatar">
        <span className="avatar-letter">{getAvatarLetter(sender)}</span>
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-sender">{sender}</span>
          <span className="message-time">{formatTime(timestamp)}</span>
        </div>
        <p className="message-text">{content}</p>
      </div>
    </div>
  );
}
