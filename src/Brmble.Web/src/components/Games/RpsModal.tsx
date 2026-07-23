import { useEffect, useState } from 'react';
import { Icon } from '../Icon/Icon';
import type { RpsView, EndedMatch, GameView } from './useGameState';
import { isRpsView } from './useGameState';
import { HeadToHead } from './HeadToHead';
import styles from './RpsModal.module.css';

interface RpsModalProps {
  view: GameView | null;
  ended: EndedMatch | null;
  myUserId: number;
  turnDeadline: number | null;
  turnWindowMs: number;
  penalty: boolean;
  resolveName: (userId: number) => string;
  onPick: (pick: string) => void;
  onForfeit: () => void;
  onClose: () => void;
}

/** The three RPS choices, in canonical order (matches the server engine). */
const PICKS: { id: string; label: string; icon: 'game-rps' }[] = [
  { id: 'rock', label: 'Rock', icon: 'game-rps' },
  { id: 'paper', label: 'Paper', icon: 'game-rps' },
  { id: 'scissors', label: 'Scissors', icon: 'game-rps' },
];

function pickLabel(pick: string): string {
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

export function RpsModal({
  view: rawView,
  ended,
  myUserId,
  turnDeadline,
  turnWindowMs,
  penalty,
  resolveName,
  onPick,
  onForfeit,
  onClose,
}: RpsModalProps) {
  const [now, setNow] = useState(() => Date.now());
  // This modal only understands the RPS view shape; ignore any other.
  const view: RpsView | null = rawView && isRpsView(rawView) ? rawView : null;

  // Drive the countdown while a live round is in progress.
  useEffect(() => {
    if (ended || turnDeadline == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [ended, turnDeadline]);

  const remainingMs = turnDeadline != null ? Math.max(0, turnDeadline - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const windowMs = turnWindowMs > 0 ? turnWindowMs : 1;
  const remainingRatio = turnDeadline != null ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;

  const players = view?.players ?? [];
  const myIndex = view ? view.players.indexOf(myUserId) : -1;
  const opponentId = players.find((p) => p !== myUserId) ?? null;

  const hasPicked = !!view?.myPick;
  const canPick = !!view && !view.finished && !ended && !hasPicked;

  const roundWinsFor = (userId: number): number => {
    if (!view) return 0;
    const idx = view.players.indexOf(userId);
    return idx >= 0 ? (view.roundWins[idx] ?? 0) : 0;
  };

  const renderLastRound = () => {
    const last = view?.lastRound;
    if (!last) return null;
    const myPick = myIndex === 0 ? last.pick0 : last.pick1;
    const oppPick = myIndex === 0 ? last.pick1 : last.pick0;
    let outcome: string;
    if (last.tie) {
      outcome = 'Tie';
    } else if (last.winnerId === myUserId) {
      outcome = 'You won the round';
    } else {
      outcome = 'You lost the round';
    }
    return (
      <div className={styles.lastRound}>
        <span className={styles.lastRoundLabel}>Round {last.roundNumber}</span>
        <span className={styles.lastRoundPicks}>
          {pickLabel(myPick)} vs {pickLabel(oppPick)}
        </span>
        <span className={styles.lastRoundOutcome}>{outcome}</span>
      </div>
    );
  };

  const renderResult = () => {
    if (!ended) return null;
    let message: string;
    if (ended.abandoned) {
      message = ended.reason ? `Match abandoned: ${ended.reason}` : 'The match was abandoned.';
    } else if (ended.winnerId != null) {
      message = ended.winnerId === myUserId ? 'You win!' : `${resolveName(ended.winnerId)} wins!`;
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
        className={`rps-modal glass-panel animate-slide-up ${styles.modal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close rock paper scissors">
          <Icon name="x" size={20} />
        </button>

        <div className="modal-header">
          <h2 className="heading-title modal-title">Rock Paper Scissors</h2>
          <p className="modal-subtitle">
            {view ? `Best of ${view.bestOf} — first to ${view.targetWins}` : 'Pick your move.'}
          </p>
        </div>

        {players.length > 0 && (
          <div className={styles.players}>
            {players.map((playerId) => (
              <div key={playerId} className={styles.player}>
                <span className={styles.playerName}>
                  {playerId === myUserId ? 'You' : resolveName(playerId)}
                </span>
                <span className={styles.playerScore}>{roundWinsFor(playerId)}</span>
              </div>
            ))}
          </div>
        )}

        {view && !ended && (
          <div className={styles.status}>
            <span className={styles.statusLabel}>Round {view.roundNumber}</span>
            <span className={styles.statusHint}>
              {hasPicked
                ? view.opponentPicked
                  ? 'Revealing…'
                  : `Waiting for ${opponentId != null ? resolveName(opponentId) : 'opponent'}…`
                : 'Make your pick'}
            </span>
          </div>
        )}

        {renderLastRound()}

        {view && !ended && !view.finished && (
          <div className={styles.countdown} aria-hidden="true">
            <div className={styles.countdownTrack}>
              <div
                className={`${styles.countdownBar} ${penalty ? styles.countdownBarPenalty : ''}`}
                style={{ width: `${remainingRatio * 100}%` }}
              />
            </div>
            <span className={`${styles.countdownLabel} ${penalty ? styles.countdownLabelPenalty : ''}`}>
              {remainingSec}s
            </span>
          </div>
        )}

        {view && !ended && (
          <div className={styles.picks}>
            {PICKS.map((p) => {
              const selected = view.myPick === p.id;
              return (
                <button
                  key={p.id}
                  className={`btn ${selected ? 'btn-primary' : ''} ${styles.pick} ${selected ? styles.pickSelected : ''}`}
                  onClick={() => onPick(p.id)}
                  disabled={!canPick}
                >
                  <Icon name={p.icon} size={24} />
                  <span className={styles.pickLabel}>{p.label}</span>
                </button>
              );
            })}
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
            <button className="btn btn-danger" onClick={onForfeit}>Forfeit</button>
          )}
        </div>
      </div>
    </div>
  );
}
