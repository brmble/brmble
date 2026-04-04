import { Icon } from '../Icon/Icon';
import { UserPanel } from '../UserPanel/UserPanel';
import { BrmbleLogo } from './BrmbleLogo';
import bridge from '../../bridge';
import './Header.css';

interface HeaderProps {
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
  onToggleGame?: () => void;
  leaveVoiceOnCooldown?: boolean;
  muteOnCooldown?: boolean;
  deafOnCooldown?: boolean;
}

export function Header({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, onAvatarClick, avatarUrl, matrixUserId, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, screenSharing, screenShareError, onToggleScreenShare, canScreenShare, speaking, pendingChannelAction, hotkeyPressedBtn, onToggleGame, leaveVoiceOnCooldown, muteOnCooldown, deafOnCooldown }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <BrmbleLogo size={32} onClick={onToggleGame} />
        <h1 className="header-logo">BRMBLE</h1>
      </div>

      <div className="header-right">
        <UserPanel
          username={username}
          onToggleDM={onToggleDM}
          dmActive={dmActive}
          unreadDMCount={unreadDMCount}
          onOpenSettings={onOpenSettings}
          onAvatarClick={onAvatarClick}
          avatarUrl={avatarUrl}
          matrixUserId={matrixUserId}
          muted={muted}
          deafened={deafened}
          leftVoice={leftVoice}
          canRejoin={canRejoin}
          onToggleMute={onToggleMute}
          onToggleDeaf={onToggleDeaf}
          onLeaveVoice={onLeaveVoice}
          screenSharing={screenSharing}
          screenShareError={screenShareError}
          onToggleScreenShare={onToggleScreenShare}
          canScreenShare={canScreenShare}
          speaking={speaking}
          pendingChannelAction={pendingChannelAction}
          hotkeyPressedBtn={hotkeyPressedBtn}
          leaveVoiceOnCooldown={leaveVoiceOnCooldown}
          muteOnCooldown={muteOnCooldown}
          deafOnCooldown={deafOnCooldown}
        />
      </div>

      <div className="window-controls">
        <button className="window-btn window-btn-minimize" onClick={() => bridge.send('window.minimize')} aria-label="Minimize">
          <Icon name="window-minimize" size={10} />
        </button>
        <button className="window-btn window-btn-maximize" onClick={() => bridge.send('window.maximize')} aria-label="Maximize">
          <Icon name="window-maximize" size={10} />
        </button>
        <button className="window-btn window-btn-close" onClick={() => bridge.send('window.close')} aria-label="Close">
          <Icon name="window-close" size={10} />
        </button>
      </div>
    </header>
  );
}
