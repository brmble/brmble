import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/Icon';
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
const PICKS: { id: string; label: string; icon: IconName }[] = [
  { id: 'rock', label: 'Rock', icon: 'rps-rock' },
  { id: 'paper', label: 'Paper', icon: 'rps-paper' },
  { id: 'scissors', label: 'Scissors', icon: 'rps-scissors' },
];

/** Seconds of anticipation shown before a resolved round is revealed. */
const REVEAL_SECONDS = 3;

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
  const incoming: RpsView | null = rawView && isRpsView(rawView) ? rawView : null;

  // Reveal suspense: when a round resolves, the server sends the updated view (and,
  // on the final round, `game.ended` right after — which nulls the view). We hold the
  // pre-resolution board frozen, run a short 3…2…1 countdown, then reveal the result.
  // `display` is the gated view actually rendered; `incoming` is the raw latest.
  const [display, setDisplay] = useState<RpsView | null>(incoming);
  const [revealCount, setRevealCount] = useState<number | null>(null);
  const shownRoundRef = useRef(0);
  const initedRef = useRef(false);
  const pendingRef = useRef<RpsView | null>(null);

  useEffect(() => {
    if (!incoming) return; // ignore the null the server sends on game.ended
    if (!initedRef.current) {
      // First view for this match: adopt it without suspense (covers joining mid-game).
      initedRef.current = true;
      shownRoundRef.current = incoming.lastRound?.roundNumber ?? 0;
      setDisplay(incoming);
      return;
    }
    const last = incoming.lastRound;
    if (last && last.roundNumber > shownRoundRef.current) {
      // A round just resolved — freeze the old board and start the reveal countdown.
      pendingRef.current = incoming;
      setRevealCount(REVEAL_SECONDS);
    } else {
      setDisplay(incoming);
    }
  }, [incoming]);

  // Ticks the reveal countdown; on reaching 0 it commits the pending resolved view.
  useEffect(() => {
    if (revealCount == null) return;
    if (revealCount <= 0) {
      const pv = pendingRef.current;
      if (pv) {
        shownRoundRef.current = pv.lastRound?.roundNumber ?? shownRoundRef.current;
        setDisplay(pv);
        pendingRef.current = null;
      }
      setRevealCount(null);
      return;
    }
    const id = window.setTimeout(() => setRevealCount((c) => (c == null ? null : c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [revealCount]);

  const revealing = revealCount != null;
  const view = display;

  // Drive the turn countdown while a live round is in progress (not during reveal).
  useEffect(() => {
    if (ended || revealing || turnDeadline == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [ended, revealing, turnDeadline]);

  const remainingMs = turnDeadline != null ? Math.max(0, turnDeadline - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const windowMs = turnWindowMs > 0 ? turnWindowMs : 1;
  const remainingRatio = turnDeadline != null ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;

  const players = view?.players ?? [];
  const myIndex = view ? view.players.indexOf(myUserId) : -1;
  const opponentId = players.find((p) => p !== myUserId) ?? null;

  const hasPicked = !!view?.myPick;
  const canPick = !!view && !view.finished && !ended && !hasPicked && !revealing;
  // Hold the end result banner until the final round's reveal has finished.
  const showResult = !!ended && !revealing;

  const roundWinsFor = (userId: number): number => {
    if (!view) return 0;
    const idx = view.players.indexOf(userId);
    return idx >= 0 ? (view.roundWins[idx] ?? 0) : 0;
  };

  const renderLastRound = () => {
    // Suppress the previous round's summary while a new one is being revealed.
    if (revealing) return null;
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
    if (!showResult) return null;
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

        {view && !showResult && (
          <div className={styles.status}>
            <span className={styles.statusLabel}>Round {view.roundNumber}</span>
            {revealing ? (
              <div className={styles.reveal} aria-live="assertive">
                <span className={styles.revealCount}>{revealCount}</span>
                <span className={styles.revealHint}>Revealing…</span>
              </div>
            ) : (
              <span className={styles.statusHint}>
                {hasPicked
                  ? view.opponentPicked
                    ? 'Revealing…'
                    : `Waiting for ${opponentId != null ? resolveName(opponentId) : 'opponent'}…`
                  : 'Make your pick'}
              </span>
            )}
          </div>
        )}

        {renderLastRound()}

        {view && !showResult && !view.finished && !revealing && (
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

        {view && !showResult && (
          <div className={styles.picks}>
            {PICKS.map((p) => {
              const selected = view.myPick === p.id;
              return (
                <button
                  key={p.id}
                  className={`btn ${selected ? 'btn-primary' : 'btn-secondary'} ${styles.pick} ${selected ? styles.pickSelected : ''}`}
                  onClick={() => onPick(p.id)}
                  disabled={!canPick}
                  aria-pressed={selected}
                >
                  <Icon name={p.icon} size={28} />
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
          {showResult ? (
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          ) : (
            <button className="btn btn-danger" onClick={onForfeit}>Forfeit</button>
          )}
        </div>
      </div>
    </div>
  );
}
