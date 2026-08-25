import { useEffect, useRef, useState } from 'react';
import type { DuelPlayer, RpsSpectatorView, SpectatorMatchOutcome } from '../../api/games';
import { Icon } from '../Icon/Icon';
import { REVEAL_SECONDS, pickIcon, pickLabel } from './rpsShared';
import styles from './RpsSpectatorBoard.module.css';

interface RpsSpectatorBoardProps {
  view: RpsSpectatorView;
  players: DuelPlayer[];
  /** Present once the match has ended. */
  outcome: SpectatorMatchOutcome | null;
}

/**
 * Read-only RPS board for a non-participant.
 *
 * Commitment is rendered as a per-player STATE, never as a throw: the server's
 * `committed` array carries WHETHER each player has thrown, never WHAT. Throws are
 * revealed only from `lastRound`, which the server populates only once a round has
 * resolved.
 *
 * `view.players` and `view.winnerId` are Mumble SESSION ids.
 */
export function RpsSpectatorBoard({ view: incoming, players, outcome }: RpsSpectatorBoardProps) {
  // Reveal suspense, ported from the participant board so a watcher sitting beside a
  // player sees the same beat. Keyed on lastRound.sequence, which increments on every
  // resolution including ties. EVERYTHING below renders from `view`, never `incoming` —
  // in particular the per-player pick icons, which would otherwise spoil the reveal.
  const [view, setView] = useState<RpsSpectatorView>(incoming);
  const [revealing, setRevealing] = useState(false);
  const shownSeqRef = useRef<number | null>(null);
  const pendingRef = useRef<RpsSpectatorView | null>(null);

  useEffect(() => {
    const seq = incoming.lastRound?.sequence ?? 0;
    if (shownSeqRef.current === null) {
      // First view for this match: adopt without suspense (covers joining mid-match).
      shownSeqRef.current = seq;
      setView(incoming);
      return;
    }
    if (!incoming.lastRound) {
      // `useSpectatorState` swaps in a new match without unmounting us, and the server
      // only ever moves `lastRound` forwards within a match — so a null here can only
      // mean a fresh match. Without this reset, match 2's early rounds fail the
      // `seq > shown` test against match 1's higher sequence, fall through to the
      // ungated setter and are revealed with no beat at all until the count catches up.
      shownSeqRef.current = 0;
      pendingRef.current = null;
      setRevealing(false);
      setView(incoming);
      return;
    }
    if (seq > shownSeqRef.current) {
      // A round just resolved: hold the old frame and start the countdown. A later frame
      // arriving mid-reveal lands here too (its seq is still ahead of what is shown), so
      // it supersedes `pendingRef` rather than reaching setView — latest-wins, one reveal.
      pendingRef.current = incoming;
      setRevealing(true);
      return;
    }
    setView(incoming);
  }, [incoming]);

  useEffect(() => {
    if (!revealing) return;
    const id = window.setTimeout(() => {
      const pending = pendingRef.current;
      if (pending) {
        shownSeqRef.current = pending.lastRound?.sequence ?? shownSeqRef.current;
        setView(pending);
        pendingRef.current = null;
      }
      setRevealing(false);
    }, REVEAL_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [revealing]);

  const nameOf = (sessionId: number) =>
    players.find(player => player.sessionId === sessionId)?.displayName ?? String(sessionId);

  // Hold the end banner until the deciding round's reveal has finished, as the
  // participant board does. The server publishes the deciding round's frame and the
  // match-ended signal back to back, so both arrive in one render — without this the
  // watcher reads the winner three seconds early, over the previous round's throws.
  const result = !outcome || revealing
    ? null
    : outcome.draw
      ? 'The match ended in a draw.'
      : outcome.winnerId != null
        ? `${nameOf(outcome.winnerId)} wins!`
        : 'The match has ended.';

  // Deliberate divergence from the participant board, which blanks the previous round's
  // summary during the reveal: here it keeps showing round N-1. Chosen, not overlooked —
  // a spectator has no throw of their own in play, so there is no context to protect, and
  // a blank panel mid-reveal would read as a glitch on a read-only surface.
  const lastRoundText = !view.lastRound
    ? null
    : view.lastRound.tie
      ? `Round ${view.lastRound.roundNumber}: tie — ${pickLabel(view.lastRound.pick0)} vs ${pickLabel(view.lastRound.pick1)}`
      : `Round ${view.lastRound.roundNumber}: ${pickLabel(view.lastRound.pick0)} vs ${pickLabel(view.lastRound.pick1)}`
        + (view.lastRound.winnerId != null ? ` — ${nameOf(view.lastRound.winnerId)} takes it` : '');

  return (
    <div className={styles.board}>
      <div className={styles.players}>
        {view.players.map((sessionId, index) => (
          <div key={sessionId} className={styles.player}>
            <span className={styles.playerName}>{nameOf(sessionId)}</span>
            <span className={styles.playerScore} data-testid={`spectator-score-${sessionId}`}>
              {view.roundWins[index] ?? 0}
            </span>
            <span className={styles.commit} data-testid={`spectator-commit-${sessionId}`}>
              {view.finished ? '' : view.committed[index] ? 'Thrown' : 'Choosing…'}
            </span>
            {view.lastRound && (() => {
              // Indexed, never `index === 0 ? pick0 : pick1`: a third card would otherwise
              // be attributed a throw it never made. Unreachable today, but this file
              // degrades rather than invents everywhere else.
              const pick = [view.lastRound.pick0, view.lastRound.pick1][index];
              if (pick == null) return null;
              const icon = pickIcon(pick);
              return (
                <span
                  className={styles.playerPick}
                  data-testid={`spectator-pick-${sessionId}`}
                  data-pick={pick}
                  // `Icon` is aria-hidden, so this label is the only accessible name —
                  // it needs a role to be reliably exposed. For a no-throw the label
                  // states the fact instead of repeating the visible "No throw" text,
                  // which aria-label would silence anyway.
                  role="img"
                  aria-label={
                    icon
                      ? `${nameOf(sessionId)} threw ${pickLabel(pick)}`
                      : `${nameOf(sessionId)} did not throw`
                  }
                >
                  {icon ? <Icon name={icon} size={24} /> : pickLabel(pick)}
                </span>
              );
            })()}
          </div>
        ))}
      </div>

      <p className={styles.format}>
        Best of {view.bestOf} · first to {view.targetWins} · round {view.roundNumber}
      </p>

      {lastRoundText && (
        <div className={styles.lastRound} data-testid="spectator-last-round">
          <span className={styles.lastRoundLabel}>Last round</span>
          <span className={styles.lastRoundText}>{lastRoundText}</span>
        </div>
      )}

      {result && (
        <div className={styles.result} role="status">
          <p className={styles.resultText}>{result}</p>
        </div>
      )}
    </div>
  );
}
