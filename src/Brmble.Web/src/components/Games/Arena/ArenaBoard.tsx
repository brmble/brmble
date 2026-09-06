import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../Icon/Icon';
import { Tooltip } from '../../Tooltip/Tooltip';
import { PREDICTION_V1 } from './arenaProtocol';
import type { ArenaMatchClosed, ArenaPhase, ArenaPlayerSnapshot, ArenaStateSnapshot } from './arenaProtocol';
import type { EndedMatch } from '../useGameState';
import { ArenaRenderer } from './ArenaRenderer';
import { sampleKnockout, vanishInPlace, type ArenaKnockout } from './arenaKnockout';
import { useArenaConnection } from './useArenaConnection';
import { useArenaState } from './useArenaState';
import { useArenaInput } from './useArenaInput';
import styles from './ArenaBoard.module.css';

interface ArenaBoardProps {
  matchId: number;
  selfSessionId: number;
  resolveName: (sessionId: number) => string;
  resolveAvatarUrl: (sessionId: number) => string | null | undefined;
  onForfeit: () => void;
  onClose: () => void;
  onRematch?: () => void;
  rematchPending?: boolean;
  ended: ArenaMatchClosed | EndedMatch | null;
}

const phaseLabels: Record<ArenaPhase, string> = {
  awaitingParticipants: 'Awaiting participants', loading: 'Loading', positioning: 'Positioning',
  live: 'Live', roundReset: 'Round reset', ended: 'Ended',
};

function direction(player: ArenaPlayerSnapshot): string {
  const angle = Math.atan2(player.aimY, player.aimX) * 180 / Math.PI;
  const directions = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return directions[Math.round((angle + 360) / 45) % 8];
}

function chargeBand(charge: number): string {
  if (charge < 250) return '0 to 24 percent';
  if (charge < 500) return '25 to 49 percent';
  if (charge < 750) return '50 to 74 percent';
  return '75 to 100 percent';
}

function radiusBand(radius: number): string {
  const lower = Math.floor(radius / 500) * 500;
  return `${lower} to ${lower + 499}`;
}

function forcedFireState(ticks: number | null): string {
  if (ticks === null) return '';
  return ticks <= 6 ? ', forced fire imminent' : ', forced fire armed';
}

function cooldownState(ticks: number): string {
  return ticks <= 0 ? 'ready' : 'cooling down';
}

function projectileSummary(state: ArenaStateSnapshot): string {
  if (state.projectiles.length === 0) return '0 projectiles present.';
  const counts = new Map<0 | 1, number>();
  for (const projectile of state.projectiles) {
    const side = state.players.find(player => player.sessionId === projectile.ownerSessionId)?.side;
    if (side !== undefined) counts.set(side, (counts.get(side) ?? 0) + 1);
  }
  const owners = [...counts.entries()].map(([side, count]) => `${count} from side ${side + 1}`).join(', ');
  return `${state.projectiles.length} ${state.projectiles.length === 1 ? 'projectile' : 'projectiles'} present${owners ? `, ${owners}` : ''}.`;
}

export function ArenaBoard({
  matchId, selfSessionId, resolveName, resolveAvatarUrl, onForfeit, onClose, ended,
  onRematch, rematchPending = false,
}: ArenaBoardProps) {
  const connection = useArenaConnection({ matchId, enabled: true });
  const endedFinalState = ended && 'finalState' in ended ? ended.finalState : undefined;
  const finalState = connection.closed?.finalState ?? endedFinalState;
  // Declared here rather than beside the other outcome values below because the
  // draw-frame callback closes over them to arm the forfeit vanish.
  const forfeited = connection.closed?.reason === 'forfeited'
    || (ended && 'reason' in ended && ended.reason === 'forfeited');
  const abandoned = ended !== null && 'abandoned' in ended && ended.abandoned === true;
  // GamePlayer.UserId is a misnomer: GameSessionManager builds it from the
  // reservation SessionId, so winnerId is a session id, not a user id.
  const winnerId = ended && 'winnerId' in ended ? ended.winnerId : undefined;
  const drawFrameRef = useRef<(state: ReturnType<typeof useArenaState>) => void>(() => {});
  // Declared above `useArenaState` because the hook takes it as an option: the knockout
  // animation is sampled inside its frame loop, and the hook must not open a second
  // matchMedia listener of its own for a setting this component already owns.
  const [reducedMotion, setReducedMotion] = useState(false);
  const state = useArenaState({
    welcome: connection.welcome, latestSnapshot: connection.latestSnapshot,
    pendingInputs: connection.pendingInputs, recentInputs: connection.recentInputs,
    currentInput: connection.currentInput,
    selfSessionId, finalState, reducedMotion, onFrame: current => drawFrameRef.current(current),
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const latestFrameRef = useRef(state);
  const [renderer, setRenderer] = useState<ArenaRenderer | null>(null);
  const localPlayerRef = useRef(state.localPlayer);
  // Presentation only, and never written back into any state the hook owns. A
  // forfeit or abandon ends the match with the loser standing still, so they are
  // puffed out of existence rather than left frozen on the board. Armed once and
  // then held for good: the match is over, so there is no later frame to hand the
  // board back to, and clearing it would pop the vanished body back into view.
  const vanishRef = useRef<ArenaKnockout | null>(null);
  const vanishArmedRef = useRef(false);
  const vanishMatchRef = useRef(matchId);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new ArenaRenderer(canvas);
    rendererRef.current = renderer;
    setRenderer(renderer);
    drawFrameRef.current(latestFrameRef.current);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setRenderer(null);
    };
  }, []);

  const input = useArenaInput({
    canvasRef,
    renderer,
    localPlayerRef,
    connection,
    enabled: renderer !== null && connection.status === 'connected' && connection.closed === null && ended === null,
    combatEnabled: state.phase === 'live' && state.localPlayer?.cooldownTicks === 0,
  });

  useLayoutEffect(() => input.release, [matchId]);

  drawFrameRef.current = current => {
    latestFrameRef.current = current;
    // `current.localPlayer` is the display-constrained position, and this ref is what
    // `useArenaInput` measures pointer aim from. That coupling is deliberate and
    // spec-mandated: aim must match what the player sees on screen. It is also the one
    // path by which the constrained value re-enters `useArenaState` — and only as a
    // normalised unit aim vector in the input stream, never as a position.
    localPlayerRef.current = current.localPlayer;
    const players = [current.localPlayer, current.remotePlayer].filter((player): player is ArenaPlayerSnapshot => player !== null);
    // welcome is null on the terminal final-state path (useArenaState.ts:329), which still
    // renders a non-null arena. Safe: ArenaPredictionConstants is literal-typed, so any
    // welcome.prediction is value-identical to PREDICTION_V1. Revisit if protocol v2 makes
    // these constants variable.
    const prediction = connection.welcome?.prediction ?? PREDICTION_V1;
    const now = performance.now();
    // Held "for good" means for this match only. The board is reused across a
    // rematch, so a new match id retires the previous vanish — otherwise the
    // rematch opens with one player already puffed off the board. Reset here
    // rather than in an effect so it cannot race the frame loop.
    if (vanishMatchRef.current !== matchId) {
      vanishMatchRef.current = matchId;
      vanishArmedRef.current = false;
      vanishRef.current = null;
    }
    // A forfeit reaches the board as two independent messages — the duel bridge
    // names the winner, the arena socket delivers the final board — so both have
    // to have landed. Without a winner there is no way to tell who left, and
    // vanishing the wrong player is worse than leaving both standing.
    if (!vanishArmedRef.current && (forfeited || abandoned) && finalState !== undefined && winnerId != null) {
      vanishArmedRef.current = true;
      vanishRef.current = vanishInPlace(
        finalState,
        finalState.players.filter(player => player.sessionId !== winnerId).map(player => player.sessionId),
        now,
      );
    }
    // The vanish supersedes any knockout the hook is still animating: the match is
    // already over, so the earlier round's fall has nothing left to say.
    const knockout = vanishRef.current === null
      ? current.knockout
      : sampleKnockout(vanishRef.current, now, prediction.playerRadius, reducedMotion);
    if (current.arena) rendererRef.current?.render({
      selfSessionId, players, projectiles: current.projectiles, arena: current.arena,
      names: Object.fromEntries(players.map(player => [player.sessionId, resolveName(player.sessionId)])),
      avatarUrls: Object.fromEntries(players.map(player => [player.sessionId, resolveAvatarUrl(player.sessionId)])),
      prediction,
      knockout,
    }, { reducedMotion });
  };

  const authoritative = finalState ?? connection.latestSnapshot ?? connection.welcome?.state ?? null;
  // The match result rides the duel event bridge (`ended`); the arena socket only
  // supplies the final board positions. Gating the outcome on the socket produced
  // three different screens for one match depending on which one survived.
  const matchEnded = ended !== null || connection.closed !== null;
  const boardUnavailable = matchEnded && finalState === undefined;
  const players = authoritative?.players ?? [];
  const serverTick = connection.closed?.serverTick
    ?? (ended && 'serverTick' in ended ? ended.serverTick : undefined)
    ?? connection.latestSnapshot?.serverTick
    ?? connection.welcome?.serverTick
    ?? 0;
  const countdownTicks = authoritative?.phaseEndsAtTick == null ? 0 : Math.max(0, authoritative.phaseEndsAtTick - serverTick);
  const countdownSeconds = Math.ceil(countdownTicks / (connection.welcome?.tickRate ?? 60));
  const phase = authoritative ? phaseLabels[authoritative.phase] : connection.status === 'connected' ? 'Loading' : connection.status;
  const score = authoritative?.score ?? state.score;
  const round = score[0] + score[1] + 1;
  // The pre-round window is the only time the arena is idle, so it is where the
  // countdown and the control legend belong. Both vanish the moment play starts.
  const pregame = authoritative?.phase === 'loading' || authoritative?.phase === 'positioning';
  const drawn = ended !== null && 'draw' in ended && ended.draw === true;
  const local = players.find(player => player.sessionId === selfSessionId) ?? null;
  const opponent = players.find(player => player.sessionId !== selfSessionId) ?? null;
  const localSide = local?.side ?? 0;
  // Two independent authoritative sources: the duel bridge names a winner, and a
  // delivered final board carries the settled score. Either is enough, so the
  // outcome survives losing one of them.
  const outcomeKnown = matchEnded
    && (forfeited || drawn || winnerId != null || finalState !== undefined);
  const roundLabel = matchEnded
    ? forfeited
      ? 'Match forfeited'
      : outcomeKnown ? 'Match complete' : 'Match ended'
    : `Round ${round}${(authoritative?.consecutiveDoubleKos ?? 0) > 0
      ? ` · Double KO replay ${authoritative!.consecutiveDoubleKos}`
      : ''}`;
  const outcome = !matchEnded
    ? 'Match in progress'
    : forfeited
      ? 'Forfeit'
      : drawn
        ? 'Draw'
        // GamePlayer.UserId is a misnomer: winnerId is a session id (see above).
        : winnerId != null
          ? winnerId === selfSessionId ? 'Victory' : 'Defeat'
          : finalState !== undefined
            ? score[0] === score[1]
              ? 'Draw'
              : score[localSide] > score[localSide === 0 ? 1 : 0] ? 'Victory' : 'Defeat'
            : 'unavailable';
  const liveText = [
    `${roundLabel}.`,
    ...(boardUnavailable ? ['Final match state unavailable.'] : []),
    `${phase}${authoritative?.phaseEndsAtTick == null ? '' : `, ${countdownSeconds} ${countdownSeconds === 1 ? 'second' : 'seconds'} remaining`}.`,
    `Score ${score[0]} to ${score[1]}.`,
    ...players.map(player => `${resolveName(player.sessionId)}, side ${player.side + 1}, aim ${direction(player)}, charge ${chargeBand(player.chargePermille)}${forcedFireState(player.forcedFireTicks)}.`),
    authoritative ? projectileSummary(authoritative) : '0 projectiles present.',
    authoritative ? `Arena radius ${radiusBand(authoritative.arena.radius)}, shrink phase ${authoritative.arena.shrinkPhase}.` : 'Arena unavailable.',
    local ? `Shot ${cooldownState(local.cooldownTicks)}; ${local.dashAvailable ? 'dash available' : 'dash used'}.` : 'Local combat state unavailable.',
    outcomeKnown || !matchEnded ? `Outcome: ${outcome}.` : 'Outcome unavailable.',
  ].join(' ');
  const handleForfeit = () => {
    input.release();
    onForfeit();
  };
  const handleClose = () => {
    input.release();
    onClose();
  };
  const resultMessage = ended && 'abandoned' in ended && ended.abandoned
    ? ended.reason ? `Match abandoned: ${ended.reason}` : 'The match was abandoned.'
    : forfeited
      ? 'Match forfeited.'
      : drawn || (winnerId == null && finalState !== undefined && score[0] === score[1])
        ? 'Draw.'
        : winnerId != null
          ? winnerId === selfSessionId ? 'You win!' : `${resolveName(winnerId)} wins!`
          : finalState !== undefined
            ? outcome === 'Victory' || opponent === null
              ? 'You win!'
              : `${resolveName(opponent.sessionId)} wins!`
            : 'The match has ended.';

  return (
    <section className={`arena-board glass-panel animate-slide-up ${styles.board}`} data-testid="arena-board">
      <header className={`modal-header ${styles.header}`}>
        <div className={styles.titleBlock}>
          <h2 className="heading-title modal-title">Arena Knockoff</h2>
          <p className="modal-subtitle">{roundLabel}</p>
        </div>
        <div className={styles.headerSide}>
          <div className={styles.hud}>
            <span data-testid="arena-score" className={styles.score}>{score[0]} – {score[1]}</span>
            <span>{phase}{authoritative?.phaseEndsAtTick == null ? '' : ` · ${countdownSeconds}s`}</span>
            <Tooltip content="Arena audio arrives in a later release" delay={0}>
              <button className={`btn btn-secondary btn-sm ${styles.audio}`} aria-disabled="true" aria-label="Arena audio unavailable" onClick={event => event.preventDefault()}>
                <Icon name="headphones-off" />
              </button>
            </Tooltip>
          </div>
          <div className={styles.actions}>
            {matchEnded
              ? onRematch && (
                <button className="btn btn-secondary" onClick={onRematch} disabled={rematchPending}>
                  {rematchPending ? 'Rematch pending' : 'Rematch'}
                </button>
              )
              : <button className="btn btn-danger" onClick={handleForfeit}>Forfeit</button>}
          </div>
        </div>
      </header>
      <div className={styles.canvasBox}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        {pregame && (
          // aria-hidden: arena-live-region already announces phase and countdown.
          <div className={styles.pregame} data-testid="arena-pregame" aria-hidden="true">
            <span
              data-testid="arena-countdown"
              className={`${styles.countdown}${reducedMotion ? '' : ` ${styles.countdownPulse}`}`}
            >
              {countdownSeconds}
            </span>
            <ul className={styles.legend}>
              <li className={styles.legendItem}>
                <Icon name="keys-wasd" className={styles.legendIcon} />
                <span>WASD to move</span>
              </li>
              <li className={styles.legendItem}>
                <Icon name="key-space" className={styles.legendIcon} />
                <span>Spacebar to dash</span>
              </li>
              <li className={styles.legendItem}>
                <Icon name="mouse-left" className={styles.legendIcon} />
                <span>Hold to shoot</span>
              </li>
            </ul>
          </div>
        )}
      </div>
      {matchEnded && (
        <div className={styles.footer} data-testid="arena-footer">
          <div className={styles.result}>
            <p className={styles.resultText}>{resultMessage}</p>
          </div>
          <button className="btn btn-primary" onClick={handleClose}>Close</button>
        </div>
      )}
      <div className="sr-only" data-testid="arena-live-region" role="status" aria-live="polite">{liveText}</div>
    </section>
  );
}
