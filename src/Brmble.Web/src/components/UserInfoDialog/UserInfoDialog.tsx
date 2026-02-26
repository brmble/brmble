import { useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import './UserInfoDialog.css';

export interface UserInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  session: number;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  isSelf: boolean;
  comment?: string;
}

export function UserInfoDialog({
  isOpen,
  onClose,
  userName,
  session,
  channelId,
  muted,
  deafened,
  isSelf,
  comment,
}: UserInfoDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(100);
  const [saved, setSaved] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    
    const savedVolume = localStorage.getItem(`volume_${session}`);
    if (savedVolume) {
      const vol = parseInt(savedVolume);
      setVolume(vol);
      bridge.send('voice.setVolume', { session, volume: vol });
    }
    
    const savedMuted = localStorage.getItem(`localMute_${session}`) === 'true';
    setLocalMuted(savedMuted);
    bridge.send('voice.setLocalMute', { session, muted: savedMuted });
  }, [isOpen, session]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const card = dialogRef.current;
    if (!card) return;

    const focusable = card.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTrap);
    return () => window.removeEventListener('keydown', handleTrap);
  }, [isOpen]);

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(`volume_${session}`, String(volume));
    bridge.send('voice.setVolume', { session, volume });
    setSaved(true);
  };

  const toggleLocalMute = () => {
    const newMuted = !localMuted;
    setLocalMuted(newMuted);
    localStorage.setItem(`localMute_${session}`, String(newMuted));
    bridge.send('voice.setLocalMute', { session, muted: newMuted });
  };

  if (!isOpen) return null;

  return (
    <div className="user-info-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="user-info-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="user-info-header">
          <div className="user-info-avatar">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="user-info-title-row">
            <h2 id="user-info-title" className="user-info-name">{userName}</h2>
            {isSelf && <span className="user-info-badge">you</span>}
          </div>
        </div>

        <div className="user-info-content">
          <div className="user-info-row">
            <span className="user-info-label">Session</span>
            <span className="user-info-value">{session}</span>
          </div>
          {channelId !== undefined && (
            <div className="user-info-row">
              <span className="user-info-label">Channel</span>
              <span className="user-info-value">{channelId}</span>
            </div>
          )}
          <div className="user-info-row">
            <span className="user-info-label">Muted</span>
            <span className={`user-info-value ${muted ? 'status-active' : ''}`}>
              {muted ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="user-info-row">
            <span className="user-info-label">Deafened</span>
            <span className={`user-info-value ${deafened ? 'status-active' : ''}`}>
              {deafened ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        <div className="user-info-volume-section">
          <div className="user-info-volume-header">
            <span className="user-info-label">Volume</span>
            <span className="user-info-volume-value">{volume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            value={volume}
            onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
            className="user-info-volume-slider"
          />
          <div className="user-info-volume-labels">
            <span>0%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>

        <div className="user-info-mute-section">
          <span className="user-info-label">Local Mute</span>
          <button 
            className={`user-info-mute-btn ${localMuted ? 'muted' : ''}`}
            onClick={toggleLocalMute}
          >
            {localMuted ? 'Unmute' : 'Mute'}
          </button>
        </div>

        <div className="user-info-comment-section">
          <span className="user-info-label">Comment</span>
          <div className="user-info-comment-box">
            {comment || 'No comment set'}
          </div>
        </div>

        <div className="user-info-actions">
          {volume !== 100 && (
            <button className="user-info-btn save" onClick={handleSave}>
              {saved ? 'Saved!' : 'Save'}
            </button>
          )}
          <button className="user-info-btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
