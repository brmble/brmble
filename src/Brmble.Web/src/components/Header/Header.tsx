import { UserPanel } from '../UserPanel/UserPanel';
import bridge from '../../bridge';
import './Header.css';

interface HeaderProps {
  username?: string;
  onToggleDM: () => void;
  dmActive?: boolean;
  unreadDMCount?: number;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
}

export function Header({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, muted, deafened, onToggleMute, onToggleDeaf }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-logo">BRMBLE</h1>
      </div>

      <div className="header-right">
        <UserPanel
          username={username}
          onToggleDM={onToggleDM}
          dmActive={dmActive}
          unreadDMCount={unreadDMCount}
          onOpenSettings={onOpenSettings}
          muted={muted}
          deafened={deafened}
          onToggleMute={onToggleMute}
          onToggleDeaf={onToggleDeaf}
        />
      </div>

      <div className="window-controls">
        <button className="window-btn window-btn-minimize" onClick={() => bridge.send('window.minimize')} aria-label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="window-btn window-btn-maximize" onClick={() => bridge.send('window.maximize')} aria-label="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="window-btn window-btn-close" onClick={() => bridge.send('window.close')} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </header>
  );
}
