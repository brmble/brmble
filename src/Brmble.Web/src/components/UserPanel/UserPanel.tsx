import { useState } from 'react';
import { Tooltip } from '../Tooltip/Tooltip';
import Avatar from '../Avatar/Avatar';
import './UserPanel.css';

interface UserPanelProps {
  username?: string;
  onToggleDM?: () => void;
  dmActive?: boolean;
  unreadDMCount?: number;
  onOpenSettings: () => void;
  onAvatarClick?: () => void;
  avatarUrl?: string;
  matrixUserId?: string;
  muted?: boolean;
  deafened?: boolean;
  leftVoice?: boolean;
  canRejoin?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
  onLeaveVoice?: () => void;
  screenSharing?: boolean;
  screenShareError?: string | null;
  onToggleScreenShare?: () => void;
  canScreenShare?: boolean;
  speaking?: boolean;
  pendingChannelAction?: number | 'leave' | null;
  hotkeyPressedBtn?: string | null;
  leaveVoiceOnCooldown?: boolean;
  muteOnCooldown?: boolean;
  deafOnCooldown?: boolean;
}

export function UserPanel({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, onAvatarClick, avatarUrl, matrixUserId, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, screenSharing, screenShareError, onToggleScreenShare, canScreenShare, speaking, pendingChannelAction, hotkeyPressedBtn, leaveVoiceOnCooldown, muteOnCooldown, deafOnCooldown }: UserPanelProps) {
  const [pressedBtn, setPressedBtn] = useState<string | null>(null);
  const activeBtn = hotkeyPressedBtn || pressedBtn;

  const handleMouseDown = (btn: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setPressedBtn(btn);
  };

  const handleMouseUp = (btn: string, action?: () => void) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (pressedBtn === btn && action) {
      action();
    }
    setPressedBtn(null);
  };

  const handleMouseLeave = () => {
    if (pressedBtn) setPressedBtn(null);
  };

  const handleKeyDown = (btn: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPressedBtn(btn);
    }
  };

  const handleKeyUp = (btn: string, action?: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (pressedBtn === btn && action) {
        action();
      }
      setPressedBtn(null);
    }
  };

  return (
    <div className="user-panel">
      {onLeaveVoice && (
        <Tooltip content={leftVoice ? 'Rejoin Voice' : 'Leave Voice'} position="bottom" align="start">
        <span className="tooltip-wrapper">
        <button 
          className={`btn btn-ghost btn-icon user-panel-btn leave-voice-btn ${leftVoice ? 'active' : ''} ${activeBtn === 'leave' ? 'pressed' : ''} ${(!!leftVoice && !canRejoin) || pendingChannelAction !== null || leaveVoiceOnCooldown ? 'disabled' : ''}`}
          onMouseDown={handleMouseDown('leave')}
          onMouseUp={handleMouseUp('leave', onLeaveVoice)}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown('leave')}
          onKeyUp={handleKeyUp('leave', onLeaveVoice)}
          disabled={(!!leftVoice && !canRejoin) || pendingChannelAction !== null || leaveVoiceOnCooldown}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        </button>
        </span>
        </Tooltip>
      )}

      {onToggleDeaf && (
        <Tooltip content={deafened ? 'Undeafen' : 'Deafen'} position="bottom" align="start">
        <span className="tooltip-wrapper">
        <button 
          className={`btn btn-ghost btn-icon user-panel-btn deaf-btn ${(deafened || leftVoice) ? 'active' : ''} ${activeBtn === 'deaf' ? 'pressed' : ''} ${leftVoice || deafOnCooldown ? 'disabled' : ''}`}
          onMouseDown={handleMouseDown('deaf')}
          onMouseUp={handleMouseUp('deaf', onToggleDeaf)}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown('deaf')}
          onKeyUp={handleKeyUp('deaf', onToggleDeaf)}
          disabled={leftVoice || deafOnCooldown}
        >
          {(deafened || leftVoice) ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
              <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
              <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
            </svg>
          )}
        </button>
        </span>
        </Tooltip>
      )}

      {onToggleMute && (
        <Tooltip content={muted ? 'Unmute' : deafened ? 'Muted (deafened)' : 'Mute'} position="bottom" align="start">
        <span className="tooltip-wrapper">
        <button 
          className={`btn btn-ghost btn-icon user-panel-btn mute-btn ${(muted || leftVoice || deafened) ? 'active' : ''} ${activeBtn === 'mute' ? 'pressed' : ''} ${(leftVoice || deafened || muteOnCooldown) ? 'disabled' : ''}`}
          onMouseDown={handleMouseDown('mute')}
          onMouseUp={handleMouseUp('mute', onToggleMute)}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown('mute')}
          onKeyUp={handleKeyUp('mute', onToggleMute)}
          disabled={leftVoice || deafened || muteOnCooldown}
        >
          {(muted || leftVoice || deafened) ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          )}
        </button>
        </span>
        </Tooltip>
      )}

      {onToggleScreenShare && (
        <Tooltip content={screenShareError ? `Screen share error: ${screenShareError}` : screenSharing ? 'Stop Sharing' : !canScreenShare ? 'Join a channel to share screen' : 'Share Screen'} position="bottom" align="start">
        <span className="tooltip-wrapper">
        <button
          className={`btn btn-ghost btn-icon user-panel-btn screen-share-btn ${(screenSharing || (!screenSharing && !canScreenShare)) ? 'active' : ''} ${activeBtn === 'screen' ? 'pressed' : ''} ${(!screenSharing && !canScreenShare) ? 'disabled' : ''}`}
          onMouseDown={handleMouseDown('screen')}
          onMouseUp={handleMouseUp('screen', onToggleScreenShare)}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown('screen')}
          onKeyUp={handleKeyUp('screen', onToggleScreenShare)}
          disabled={!screenSharing && !canScreenShare}
        >
          {(!screenSharing && !canScreenShare) ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          )}
        </button>
        </span>
        </Tooltip>
      )}

      {onToggleDM && (
      <Tooltip content="Direct Messages" position="bottom" align="end">
      <button
        className={`btn btn-ghost btn-icon user-panel-btn dm-btn ${dmActive ? 'active' : ''} ${activeBtn === 'dm' ? 'pressed' : ''}`}
        onMouseDown={handleMouseDown('dm')}
        onMouseUp={handleMouseUp('dm', onToggleDM)}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown('dm')}
        onKeyUp={handleKeyUp('dm', onToggleDM)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unreadDMCount != null && unreadDMCount > 0 && (
          <span className="dm-unread-badge" key={unreadDMCount}>
            {unreadDMCount > 9 ? '9+' : unreadDMCount}
          </span>
        )}
      </button>
      </Tooltip>
      )}
      
      <Tooltip content="Settings" position="bottom" align="end">
      <button 
        className="btn btn-ghost btn-icon user-panel-btn user-settings-btn" 
        onClick={onOpenSettings}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      </Tooltip>
      
      <Tooltip content={username || 'Not logged in'} position="bottom" align="end">
      <button
        className="user-avatar-trigger"
        onClick={onAvatarClick}
        disabled={!onAvatarClick}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && onAvatarClick) {
            e.preventDefault();
            onAvatarClick();
          }
        }}
      >
        <Avatar user={{ name: username || '', matrixUserId: matrixUserId, avatarUrl: avatarUrl }} size={20} speaking={speaking} />
      </button>
      </Tooltip>
    </div>
  );
}
