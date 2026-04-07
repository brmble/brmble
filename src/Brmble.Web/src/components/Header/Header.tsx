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
  onOpenAudioSettings?: () => void;
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

export function Header({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, onOpenAudioSettings, onAvatarClick, avatarUrl, matrixUserId, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, screenSharing, screenShareError, onToggleScreenShare, canScreenShare, speaking, pendingChannelAction, hotkeyPressedBtn, onToggleGame, leaveVoiceOnCooldown, muteOnCooldown, deafOnCooldown }: HeaderProps) {
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
          onOpenAudioSettings={onOpenAudioSettings}
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
