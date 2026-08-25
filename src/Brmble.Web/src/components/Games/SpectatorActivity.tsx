import { gameDisplayName } from '../../utils/games';
import { pairLabel } from './duelFormatting';
import { DeathrollSpectatorBoard } from './DeathrollSpectatorBoard';
import { RpsSpectatorBoard } from './RpsSpectatorBoard';
import { isRpsSpectatorView } from '../../api/games';
import type { DuelQueueSnapshot, SpectatorMatchEndedEvent, SpectatorSnapshot } from '../../api/games';
import styles from './SpectatorActivity.module.css';

interface SpectatorActivityProps {
  match: SpectatorSnapshot | null;
  ended: SpectatorMatchEndedEvent | null;
  /** The already-broadcast queue snapshot for the watched channel. Idle state only. */
  queueSnapshot: DuelQueueSnapshot | null;
  /** Resolves a voice SESSION id to a display name (App's resolveGamePlayerName). */
  resolveName: (sessionId: number) => string;
  onStopWatching: () => void;
}

/**
 * The 'spectate' stage. Three states, and Stop watching in all of them.
 *
 * This host supplies the shared card shell (`.glass-panel`, `.modal-header`,
 * `h2.heading-title.modal-title`). That is a design CHOICE for this surface, not a
 * guide requirement: the Minigame Panel Pattern scopes itself to a game the local
 * player is PARTICIPATING in, one that owns the whole main panel, and game mode is
 * never entered by spectating. It is chosen here because the spectator boards are
 * deliberately bare bodies and ChannelActivityRegion supplies only a channel-name +
 * chip header and an unstyled stage box — so without a shell nothing on screen would
 * name the game being watched, and this host is the only component in the spectate
 * path that knows `match.gameType`. It may be changed if a better fit is found.
 *
 * There is deliberately NO collapse or minimise affordance, for any activity kind.
 * The region is not dismissible; every activity ends by terminating itself. A
 * collapse toggle would create a subscribed-but-invisible state, which is already
 * the most expensive ambiguity in the shipped region. That is also why there is no
 * `.modal-close`: Stop watching is the one terminator.
 *
 * Because spectating is a CHANNEL mode, an ending match does not stop it: the
 * ended match is held on screen until the next one starts, and that next match
 * flows in with no resubscribe.
 */
export function SpectatorActivity({
  match, ended, queueSnapshot, resolveName, onStopWatching,
}: SpectatorActivityProps) {
  const outcome = ended?.outcome ?? null;

  const body = match
    ? isRpsSpectatorView(match.view)
      ? <RpsSpectatorBoard view={match.view} players={match.players} outcome={outcome} />
      : <DeathrollSpectatorBoard view={match.view} players={match.players} outcome={outcome} />
    : <NextUp queueSnapshot={queueSnapshot} resolveName={resolveName} />;

  return (
    <section className={`glass-panel animate-slide-up ${styles.activity}`} aria-label="Spectating">
      <div className={`modal-header ${styles.header}`}>
        <h2 className="heading-title modal-title">
          {match ? gameDisplayName(match.gameType) : 'Spectating'}
        </h2>
      </div>

      <div className={styles.stage}>{body}</div>

      <div className={styles.controls}>
        <button type="button" className="btn btn-secondary" onClick={onStopWatching}>
          Stop watching
        </button>
      </div>
    </section>
  );
}

/**
 * The Idle card. Reads the already-broadcast game.queueSnapshot, which every
 * channel member receives regardless of spectating, so this costs the server
 * nothing. No queue list and no ETAs: the queue lives in the sidebar badge and
 * DuelQueueModal, not here.
 *
 * KNOWN BOUNDARY: this is duel-specific, because "next up" reads a pair-based
 * duel queue. A future many-player minigame has no such queue and this degrades
 * to a plain waiting state for it. The Live and Ended states carry no such
 * assumption, and neither does the server half.
 */
function NextUp({
  queueSnapshot, resolveName,
}: { queueSnapshot: DuelQueueSnapshot | null; resolveName: (sessionId: number) => string }) {
  const readyCheck = queueSnapshot?.readyCheck ?? null;
  const next = queueSnapshot?.queue[0] ?? null;
  const upcoming = readyCheck ?? next;

  if (!upcoming) {
    return (
      <div className={styles.nextUp} data-testid="spectator-next-up">
        <span className={styles.nextUpLabel}>Waiting for the next match</span>
      </div>
    );
  }

  return (
    <div className={styles.nextUp} data-testid="spectator-next-up">
      <span className={styles.nextUpLabel}>{readyCheck ? 'Ready check' : 'Next up'}</span>
      <strong className={styles.nextUpPair}>{pairLabel(upcoming.players, resolveName)}</strong>
      <span className={styles.nextUpMeta}>
        {gameDisplayName(upcoming.gameType)} · {upcoming.format}
      </span>
    </div>
  );
}
