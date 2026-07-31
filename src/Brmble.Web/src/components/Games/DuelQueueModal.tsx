import { useEffect, useRef, useState } from 'react';
import { gameDisplayName } from '../../utils/games';
import { ceilToSecondMs, estimateMs, estimateText, formatDuration, pairLabel, playerName } from './duelFormatting';
import { Icon } from '../Icon/Icon';
import type { DuelQueueSnapshot } from './useDuelQueueState';
import styles from './DuelQueueModal.module.css';

interface DuelQueueModalProps {
  snapshot: DuelQueueSnapshot;
  /** Resolves a voice **session** id to a display name (see App's resolveGamePlayerName). */
  resolveName: (sessionId: number) => string;
  onClose: () => void;
}

/**
 * Re-renders once a second so elapsed/over-estimate text stays current, seeding
 * `now` whenever the match changes — the modal can sit open across duels, and a
 * `now` left frozen from a previous match would render a stale first second.
 * Display-only: it never ends, delays, or otherwise controls a match.
 */
function useSecondTick(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return now;
}

export function DuelQueueModal({ snapshot, resolveName, onClose }: DuelQueueModalProps) {
  const active = snapshot.active;
  const now = useSecondTick(active?.startedAt ?? null);
  const startedMs = active ? Date.parse(active.startedAt) : NaN;
  const elapsedMs = Number.isFinite(startedMs) ? Math.max(0, now - startedMs) : 0;
  const estimatedMs = active ? estimateMs(active.estimatedDuration) : null;
  const overMs = estimatedMs != null ? elapsedMs - estimatedMs : null;
  const isEmpty = !active && !snapshot.readyCheck && snapshot.queue.length === 0;
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
          {active && (
            <section className={styles.section} aria-label="Active duel">
              <span className={styles.label}>{active.status === 'starting' ? 'Starting' : 'Live'}</span>
              <strong className={styles.pair}>{pairLabel(active.players, resolveName)}</strong>
              <span className={styles.meta}>{gameDisplayName(active.gameType)} · {active.format} · v{active.rulesetVersion}</span>
              <span className={styles.meta}>{estimateText(active.estimatedDuration)}</span>
              <span className={styles.eta}>Elapsed: {formatDuration(elapsedMs)}</span>
              {overMs != null && (
                overMs > 0
                  ? <span className={styles.over}>{formatDuration(ceilToSecondMs(overMs))} over estimate</span>
                  : <span className={styles.eta}>Ends in about {formatDuration(ceilToSecondMs(-overMs))}</span>
              )}
            </section>
          )}

          {snapshot.readyCheck && (
            <section className={styles.section} aria-label="Ready check">
              <span className={styles.label}>Ready check</span>
              <strong className={styles.pair}>{pairLabel(snapshot.readyCheck.players, resolveName)}</strong>
              <span className={styles.meta}>{gameDisplayName(snapshot.readyCheck.gameType)} · {snapshot.readyCheck.format} · v{snapshot.readyCheck.rulesetVersion}</span>
              <span className={styles.meta}>{estimateText(snapshot.readyCheck.estimatedDuration)}</span>
              <div className={styles.readyPlayers}>
                {snapshot.readyCheck.players.map(player => (
                  <span key={`${player.userId}:${player.sessionId}`}>
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
                    <span className={styles.meta}>{gameDisplayName(entry.gameType)} · {entry.format} · v{entry.rulesetVersion}</span>
                    <span className={styles.meta}>{estimateText(entry.estimatedDuration)}</span>
                    <span className={styles.eta}>
                      {entry.eta.status === 'known' && entry.eta.milliseconds != null
                        ? `Starts in about ${formatDuration(entry.eta.milliseconds)}`
                        : 'Starts in: Unknown'}
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
