import './UserPanel.css';

interface UserPanelProps {
  username?: string;
  onToggleDM: () => void;
  dmActive?: boolean;
  unreadDMCount?: number;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  leftVoice?: boolean;
  canRejoin?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
  onLeaveVoice?: () => void;
  speaking?: boolean;
  pendingChannelAction?: number | 'leave' | null;
}

export function UserPanel({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, speaking, pendingChannelAction }: UserPanelProps) {
  return (
    <div className="user-panel">
      {onLeaveVoice && (
        <button 
          className={`user-panel-btn leave-voice-btn ${leftVoice ? 'active' : ''} ${(!!leftVoice && !canRejoin) || pendingChannelAction !== null ? 'disabled' : ''}`}
          onClick={onLeaveVoice}
          disabled={(!!leftVoice && !canRejoin) || pendingChannelAction !== null}
          title={leftVoice ? 'Rejoin Voice' : 'Leave Voice'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        </button>
      )}

      {onToggleDeaf && (
        <button 
          className={`user-panel-btn deaf-btn ${(deafened || leftVoice) ? 'active' : ''} ${leftVoice ? 'disabled' : ''}`}
          onClick={onToggleDeaf}
          disabled={leftVoice}
          title={deafened ? 'Undeafen' : 'Deafen'}
        >
          {(deafened || leftVoice) ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M6.5 6.5A10 10 0 0 1 21 12c0 3-1.5 5-5 5"></path>
              <path d="M4.5 4.5L19.5 19.5"></path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6.5 6.5A10 10 0 0 1 21 12c0 3-1.5 5-5 5"></path>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path>
              <path d="M3 3l18 18"></path>
            </svg>
          )}
        </button>
      )}

      {onToggleMute && (
        <button 
          className={`user-panel-btn mute-btn ${(muted || leftVoice) ? 'active' : ''} ${leftVoice ? 'disabled' : ''}`}
          onClick={onToggleMute}
          disabled={leftVoice}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {(muted || leftVoice) ? (
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
      )}

      <button 
        className={`user-panel-btn dm-btn ${dmActive ? 'active' : ''}`}
        onClick={onToggleDM}
        title="Direct Messages"
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
      
      <button 
        className="user-panel-btn user-settings-btn" 
        onClick={onOpenSettings}
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      
      <div className={`user-avatar ${speaking ? 'speaking' : ''}`} title={username || 'Not logged in'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="14" r="8" />
          <path d="M12 2C12 2 8 2 8 6C8 10 12 14 12 14C12 14 16 10 16 6C16 2 12 2 12 2Z" fill="var(--accent-mint)" />
        </svg>
      </div>
    </div>
  );
}
