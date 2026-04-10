import { useMemo } from 'react';
import Avatar from '../Avatar/Avatar';
import './ReplyHeader.css';

export interface ReplyState {
  eventId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  html?: string;
  msgType: string;
}

interface ReplyHeaderProps {
  replyState: ReplyState;
  onCancel: () => void;
}

function getPreviewLabel(msgType: string): string {
  switch (msgType) {
    case 'm.image': return '📷 Image';
    case 'm.video': return '🎥 Video';
    case 'm.file': return '📎 File';
    case 'm.audio': return '🎵 Audio';
    default: return '💬 Message';
  }
}

function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '…';
}

export function ReplyHeader({ replyState, onCancel }: ReplyHeaderProps) {
  const preview = useMemo(() => {
    if (replyState.msgType !== 'm.text') {
      return getPreviewLabel(replyState.msgType);
    }
    return truncateText(replyState.content);
  }, [replyState.content, replyState.msgType]);

  return (
    <div className="reply-header">
      <span className="reply-header-label">Replying to</span>
      <div className="reply-header-content">
        <Avatar 
          user={{ name: replyState.sender, matrixUserId: replyState.senderMatrixUserId }} 
          size={20} 
        />
        <span className="reply-header-sender">{replyState.sender}:</span>
        <span className="reply-header-preview">{preview}</span>
      </div>
      <button 
        className="reply-header-cancel" 
        onClick={onCancel}
        aria-label="Cancel reply"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
