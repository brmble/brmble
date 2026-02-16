import { UserPanel } from '../UserPanel/UserPanel';
import './Header.css';

interface HeaderProps {
  username?: string;
  onOpenDMPanel: () => void;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
}

export function Header({ username, onOpenDMPanel, onOpenSettings, muted, deafened, onToggleMute, onToggleDeaf }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-logo">BRMBLE</h1>
      </div>
      
      <div className="header-right">
        <UserPanel 
          username={username}
          onOpenDMPanel={onOpenDMPanel}
          onOpenSettings={onOpenSettings}
          muted={muted}
          deafened={deafened}
          onToggleMute={onToggleMute}
          onToggleDeaf={onToggleDeaf}
        />
      </div>
    </header>
  );
}
