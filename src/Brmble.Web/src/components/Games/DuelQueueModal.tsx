import { useEffect, useRef } from 'react';
import type { DuelPlayer } from '../../api/games';
import { gameDisplayName } from '../../utils/games';
import { Icon } from '../Icon/Icon';
import type { DuelQueueSnapshot } from './useDuelQueueState';
import styles from './DuelQueueModal.module.css';

interface DuelQueueModalProps {
  snapshot: DuelQueueSnapshot;
  resolveName: (userId: number) => string;
  onClose: () => void;
}

function playerName(player: DuelPlayer, resolveName: (userId: number) => string): string {
  return player.displayName.trim() || resolveName(player.sessionId || player.userId);
}

function pairLabel(players: DuelPlayer[], resolveName: (userId: number) => string): string {
  return players.map(player => playerName(player, resolveName)).join(' vs ');
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m${remainder > 0 ? ` ${remainder}s` : ''}` : `${seconds}s`;
}

export function DuelQueueModal({ snapshot, resolveName, onClose }: DuelQueueModalProps) {
  const isEmpty = !snapshot.active && !snapshot.readyCheck && snapshot.queue.length === 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)
        || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`glass-panel animate-slide-up ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duel-activity-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close duel activity">
          <Icon name="x" size={20} />
        </button>
        <div className="modal-header">
          <h2 id="duel-activity-title" className="heading-title modal-title">Duel activity</h2>
          <p className="modal-subtitle">One match at a time. Accepted pairs play in order.</p>
        </div>

        <div className={styles.content} data-testid="duel-activity-content">
          {snapshot.active && (
            <section className={styles.section} aria-label="Active duel">
              <span className={styles.label}>{snapshot.active.status === 'starting' ? 'Starting' : 'Live'}</span>
              <strong className={styles.pair}>{pairLabel(snapshot.active.players, resolveName)}</strong>
              <span className={styles.meta}>{gameDisplayName(snapshot.active.gameType)} · {snapshot.active.format}</span>
              <span className={styles.eta}>
                {snapshot.active.remaining.status === 'known' && snapshot.active.remaining.milliseconds != null
                  ? `About ${formatDuration(snapshot.active.remaining.milliseconds)}`
                  : 'Unknown'}
              </span>
            </section>
          )}

          {snapshot.readyCheck && (
            <section className={styles.section} aria-label="Ready check">
              <span className={styles.label}>Ready check</span>
              <strong className={styles.pair}>{pairLabel(snapshot.readyCheck.players, resolveName)}</strong>
              <span className={styles.meta}>{gameDisplayName(snapshot.readyCheck.gameType)} · {snapshot.readyCheck.format}</span>
              <div className={styles.readyPlayers}>
                {snapshot.readyCheck.players.map(player => (
                  <span key={player.userId || player.sessionId}>
                    {playerName(player, resolveName)} <strong>{player.ready ? 'Ready' : 'Waiting'}</strong>
                  </span>
                ))}
              </div>
            </section>
          )}

          {snapshot.queue.length > 0 && (
            <section className={styles.queueSection} aria-label="Accepted queue">
              <span className={styles.label}>Accepted queue</span>
              <ol className={styles.queue}>
                {snapshot.queue.map(entry => (
                  <li key={entry.reservationId} className={styles.queueItem}>
                    <strong className={styles.pair}>{entry.position}. {pairLabel(entry.players, resolveName)}</strong>
                    <span className={styles.meta}>{gameDisplayName(entry.gameType)} · {entry.format}</span>
                    <span className={styles.eta}>
                      {entry.eta.status === 'known' && entry.eta.milliseconds != null
                        ? `About ${formatDuration(entry.eta.milliseconds)}`
                        : 'Unknown'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {isEmpty && <p className={styles.empty}>No duel activity in this channel.</p>}
        </div>
      </div>
    </div>
  );
}
