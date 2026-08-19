import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';
import { UserPanel } from '../UserPanel/UserPanel';
import { BrmbleLogo } from './BrmbleLogo';
import bridge from '../../bridge';
import './Header.css';

interface HeaderProps {
  username?: string;
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
  isMaximized?: boolean;
  onStartPaint?: () => void;
  canStartPaint?: boolean;
  activePaintSessionId?: string | null;
}

export function Header({ username, onOpenSettings, onOpenAudioSettings, onAvatarClick, avatarUrl, matrixUserId, muted, deafened, leftVoice, canRejoin, onToggleMute, onToggleDeaf, onLeaveVoice, screenSharing, screenShareError, onToggleScreenShare, canScreenShare, speaking, pendingChannelAction, hotkeyPressedBtn, onToggleGame, leaveVoiceOnCooldown, muteOnCooldown, deafOnCooldown, isMaximized, onStartPaint, canStartPaint, activePaintSessionId }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <BrmbleLogo size={32} onClick={onToggleGame} />
        <h1 className="header-logo">BRMBLE</h1>
      </div>

      <div className="header-right">
        {onStartPaint && (
          <Tooltip content={activePaintSessionId ? 'A collaborative paint session is active' : 'Start collaborative paint'} position="bottom" align="end">
            <span className="tooltip-wrapper">
              <button type="button" className="btn btn-ghost btn-icon header-paint-button" aria-label="Start collaborative paint" onClick={onStartPaint} disabled={!canStartPaint || Boolean(activePaintSessionId)}>
                <Icon name="palette" />
              </button>
            </span>
          </Tooltip>
        )}
        <UserPanel
          username={username}
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
          <Icon name="window-minimize" size={10} />
        </button>
        <button className="window-btn window-btn-maximize" onClick={() => bridge.send('window.maximize')} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
          <Icon name={isMaximized ? 'window-restore' : 'window-maximize'} size={10} />
        </button>
        <button className="window-btn window-btn-close" onClick={() => bridge.send('window.close')} aria-label="Close">
          <Icon name="window-close" size={10} />
        </button>
      </div>
    </header>
  );
}
