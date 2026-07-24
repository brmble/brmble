import { useEffect, useState } from 'react';
import { Icon } from '../Icon/Icon';
import type { DeathrollView, EndedMatch, GameView } from './useGameState';
import { isRpsView } from './useGameState';
import { HeadToHead } from './HeadToHead';
import styles from './DeathrollModal.module.css';

interface DeathrollModalProps {
  view: GameView | null;
  ended: EndedMatch | null;
  myUserId: number;
  turnDeadline: number | null;
  turnWindowMs: number;
  penalty: boolean;
  resolveName: (userId: number) => string;
  onRoll: () => void;
  onForfeit: () => void;
  onClose: () => void;
}

export function DeathrollModal({
  view: rawView,
  ended,
  myUserId,
  turnDeadline,
  turnWindowMs,
  penalty,
  resolveName,
  onRoll,
  onForfeit,
  onClose,
}: DeathrollModalProps) {
  const [now, setNow] = useState(() => Date.now());
  // This modal only understands the Deathroll view shape; ignore any other.
  const view: DeathrollView | null = rawView && !isRpsView(rawView) ? rawView : null;

  // Drive the countdown while a live turn is in progress.
  useEffect(() => {
    if (ended || turnDeadline == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [ended, turnDeadline]);

  const remainingMs = turnDeadline != null ? Math.max(0, turnDeadline - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const windowMs = turnWindowMs > 0 ? turnWindowMs : 1;
  const remainingRatio = turnDeadline != null ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;

  const isMyTurn = !!view && !view.finished && view.currentPlayer === myUserId;
  const canRoll = isMyTurn && !ended;

  const players = view?.players ?? [];
  const opponentId = players.find((p) => p !== myUserId) ?? null;

  const renderResult = () => {
    if (!ended) return null;
    let message: string;
    if (ended.abandoned) {
      message = ended.reason
        ? `Match abandoned: ${ended.reason}`
        : 'The match was abandoned.';
    } else if (ended.winnerId != null) {
      message = ended.winnerId === myUserId
        ? 'You win!'
        : `${resolveName(ended.winnerId)} wins!`;
    } else {
      message = 'The match has ended.';
    }
    return (
      <div className={styles.result}>
        <p className={styles.resultText}>{message}</p>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`deathroll-modal glass-panel animate-slide-up ${styles.modal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close deathroll">
          <Icon name="x" size={20} />
        </button>

        <div className="modal-header">
          <h2 className="heading-title modal-title">Deathroll</h2>
          <p className="modal-subtitle">Roll low. Whoever rolls a 1 loses.</p>
        </div>

        {players.length > 0 && (
          <div className={styles.players}>
            {players.map((playerId) => {
              const isCurrent = view?.currentPlayer === playerId && !view?.finished && !ended;
              return (
                <div
                  key={playerId}
                  className={`${styles.player} ${isCurrent ? styles.playerActive : ''}`}
                >
                  <span className={styles.playerName}>
                    {playerId === myUserId ? 'You' : resolveName(playerId)}
                  </span>
                  {isCurrent && <span className={styles.playerTurn}>Rolling…</span>}
                </div>
              );
            })}
          </div>
        )}

        {view && !ended && (
          <div className={styles.board}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Ceiling</span>
              <span className={`${styles.statCeiling} ${penalty ? styles.statCeilingPenalty : ''}`}>{view.ceiling}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Last roll</span>
              <span className={styles.statValue}>{view.lastRoll ?? '—'}</span>
            </div>
          </div>
        )}

        {view && !ended && !view.finished && (
          <div className={styles.countdown} aria-hidden="true">
            <div className={styles.countdownTrack}>
              <div
                className={`${styles.countdownBar} ${penalty ? styles.countdownBarPenalty : ''}`}
                style={{ width: `${remainingRatio * 100}%` }}
              />
            </div>
            <span className={`${styles.countdownLabel} ${penalty ? styles.countdownLabelPenalty : ''}`}>{remainingSec}s</span>
          </div>
        )}

        {renderResult()}

        {opponentId != null && (
          <div className={styles.headToHead}>
            <span className={styles.headToHeadTitle}>Head-to-head</span>
            <HeadToHead opponentSession={opponentId} opponentName={resolveName(opponentId)} />
          </div>
        )}

        <div className={styles.footer}>
          {ended ? (
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button className="btn btn-danger" onClick={onForfeit}>Forfeit</button>
              <button className="btn btn-primary" onClick={onRoll} disabled={!canRoll}>
                {isMyTurn ? 'Roll' : 'Waiting…'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
