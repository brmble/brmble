import './UserPanel.css';

interface UserPanelProps {
  username?: string;
  onOpenDMPanel: () => void;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
}

export function UserPanel({ username, onOpenDMPanel, onOpenSettings, muted, deafened, onToggleMute, onToggleDeaf }: UserPanelProps) {
  return (
    <div className="user-panel">
      {onToggleMute && (
        <button 
          className={`user-panel-btn mute-btn ${muted ? 'active' : ''}`}
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
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
      
      {onToggleDeaf && (
        <button 
          className={`user-panel-btn deaf-btn ${deafened ? 'active' : ''}`}
          onClick={onToggleDeaf}
          title={deafened ? 'Undeafen' : 'Deafen'}
        >
          {deafened ? (
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
      
      <button 
        className="user-panel-btn dm-btn" 
        onClick={onOpenDMPanel}
        title="Direct Messages"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
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
      
      <div className="user-avatar" title={username || 'Not logged in'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="14" r="8" />
          <path d="M12 2C12 2 8 2 8 6C8 10 12 14 12 14C12 14 16 10 16 6C16 2 12 2 12 2Z" fill="var(--accent-mint)" />
        </svg>
      </div>
    </div>
  );
}
