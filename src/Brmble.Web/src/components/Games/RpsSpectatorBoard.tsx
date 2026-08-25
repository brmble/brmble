import type { DuelPlayer, RpsSpectatorView, SpectatorMatchOutcome } from '../../api/games';
import { Icon } from '../Icon/Icon';
import { pickIcon, pickLabel } from './rpsShared';
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
 * resolved. There is no reveal-suspense countdown here — that is a participant
 * affordance for the moment your own resolved round lands.
 *
 * `view.players` and `view.winnerId` are Mumble SESSION ids.
 */
export function RpsSpectatorBoard({ view, players, outcome }: RpsSpectatorBoardProps) {
  const nameOf = (sessionId: number) =>
    players.find(player => player.sessionId === sessionId)?.displayName ?? String(sessionId);

  const result = !outcome
    ? null
    : outcome.draw
      ? 'The match ended in a draw.'
      : outcome.winnerId != null
        ? `${nameOf(outcome.winnerId)} wins!`
        : 'The match has ended.';

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
              const pick = index === 0 ? view.lastRound.pick0 : view.lastRound.pick1;
              const icon = pickIcon(pick);
              return (
                <span
                  className={styles.playerPick}
                  data-testid={`spectator-pick-${sessionId}`}
                  data-pick={pick}
                  aria-label={`${nameOf(sessionId)} threw ${pickLabel(pick)}`}
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
