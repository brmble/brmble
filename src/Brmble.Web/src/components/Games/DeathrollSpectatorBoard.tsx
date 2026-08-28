import type { DeathrollSpectatorView, DuelPlayer, SpectatorMatchOutcome } from '../../api/games';
import styles from './DeathrollSpectatorBoard.module.css';

interface DeathrollSpectatorBoardProps {
  view: DeathrollSpectatorView;
  players: DuelPlayer[];
  /** Present once the match has ended. */
  outcome: SpectatorMatchOutcome | null;
}

/**
 * Read-only Deathroll board for a non-participant. Reuses the participant board's
 * visual language, minus every control: a spectator has no turn, so there is no
 * roll button, no forfeit and no countdown.
 *
 * `view.players`, `view.currentPlayer` and `view.loserId` are Mumble SESSION ids.
 */
export function DeathrollSpectatorBoard({ view, players, outcome }: DeathrollSpectatorBoardProps) {
  const nameOf = (sessionId: number) =>
    players.find(player => player.sessionId === sessionId)?.displayName ?? String(sessionId);

  const result = !outcome
    ? null
    : outcome.draw
      ? 'The match ended in a draw.'
      : outcome.winnerId != null
        ? `${nameOf(outcome.winnerId)} wins!`
        : 'The match has ended.';

  return (
    <div className={styles.board} data-testid="deathroll-spectator-board">
      <div className={styles.players}>
        {view.players.map(sessionId => (
          <div
            key={sessionId}
            data-testid={`spectator-player-${sessionId}`}
            data-current={String(view.currentPlayer === sessionId)}
            className={`${styles.player} ${view.currentPlayer === sessionId ? styles.playerActive : ''}`}
          >
            <span className={styles.playerName}>{nameOf(sessionId)}</span>
            {view.currentPlayer === sessionId && <span className={styles.playerTurn}>Rolling…</span>}
            {view.lastRoll != null && view.lastRollBy === sessionId && (
              <span className={styles.playerRoll} data-testid={`spectator-roll-${sessionId}`}>
                {view.lastRoll}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ceiling</span>
          <span className={styles.statValue}>{view.ceiling}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Last roll</span>
          <span className={styles.statValue}>{view.lastRoll ?? '—'}</span>
        </div>
      </div>

      {result && (
        <div className={styles.result} role="status">
          <p className={styles.resultText}>{result}</p>
        </div>
      )}
    </div>
  );
}
