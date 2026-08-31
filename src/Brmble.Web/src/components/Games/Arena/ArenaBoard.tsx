import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../Icon/Icon';
import { Tooltip } from '../../Tooltip/Tooltip';
import type { ArenaMatchClosed, ArenaPhase, ArenaPlayerSnapshot, ArenaStateSnapshot } from './arenaProtocol';
import type { EndedMatch } from '../useGameState';
import { ArenaRenderer } from './ArenaRenderer';
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
}: ArenaBoardProps) {
  const connection = useArenaConnection({ matchId, enabled: true });
  const endedFinalState = ended && 'finalState' in ended ? ended.finalState : undefined;
  const finalState = connection.closed?.finalState ?? endedFinalState;
  const drawFrameRef = useRef<(state: ReturnType<typeof useArenaState>) => void>(() => {});
  const state = useArenaState({
    welcome: connection.welcome, latestSnapshot: connection.latestSnapshot,
    pendingInputs: connection.pendingInputs, recentInputs: connection.recentInputs,
    currentInput: connection.currentInput,
    selfSessionId, finalState, onFrame: current => drawFrameRef.current(current),
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const latestFrameRef = useRef(state);
  const [renderer, setRenderer] = useState<ArenaRenderer | null>(null);
  const localPlayerRef = useRef(state.localPlayer);
  const [reducedMotion, setReducedMotion] = useState(false);

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
    localPlayerRef.current = current.localPlayer;
    const players = [current.localPlayer, current.remotePlayer].filter((player): player is ArenaPlayerSnapshot => player !== null);
    if (current.arena) rendererRef.current?.render({
      selfSessionId, players, projectiles: current.projectiles, arena: current.arena,
      names: Object.fromEntries(players.map(player => [player.sessionId, resolveName(player.sessionId)])),
      avatarUrls: Object.fromEntries(players.map(player => [player.sessionId, resolveAvatarUrl(player.sessionId)])),
    }, { reducedMotion });
  };

  const authoritative = finalState ?? connection.latestSnapshot ?? connection.welcome?.state ?? null;
  const finalized = ended !== null && finalState !== undefined;
  const finalizationPending = ended !== null && !finalized && connection.status !== 'failed';
  const finalizationFailed = ended !== null && !finalized && connection.status === 'failed';
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
  const forfeited = connection.closed?.reason === 'forfeited'
    || (ended && 'reason' in ended && ended.reason === 'forfeited');
  const roundLabel = finalizationPending
    ? 'Finalizing match'
    : finalizationFailed
      ? 'Finalization failed'
      : finalized
        ? forfeited ? 'Match forfeited' : 'Match complete'
    : `Round ${round}${(authoritative?.consecutiveDoubleKos ?? 0) > 0
      ? ` · Double KO replay ${authoritative!.consecutiveDoubleKos}`
      : ''}`;
  const local = players.find(player => player.sessionId === selfSessionId) ?? null;
  const outcome = finalized
    ? forfeited ? 'Forfeit' : score[0] === score[1] ? 'Draw' : score[local?.side ?? 0] > score[(local?.side ?? 0) === 0 ? 1 : 0] ? 'Victory' : 'Defeat'
    : finalizationFailed
      ? 'unavailable'
      : finalizationPending
        ? 'pending final state'
        : 'Match in progress';
  const liveText = [
    `${roundLabel}.`,
    ...(finalizationFailed ? ['Final match state unavailable.'] : []),
    `${phase}${authoritative?.phaseEndsAtTick == null ? '' : `, ${countdownSeconds} ${countdownSeconds === 1 ? 'second' : 'seconds'} remaining`}.`,
    `Score ${score[0]} to ${score[1]}.`,
    ...players.map(player => `${resolveName(player.sessionId)}, side ${player.side + 1}, aim ${direction(player)}, charge ${chargeBand(player.chargePermille)}${forcedFireState(player.forcedFireTicks)}.`),
    authoritative ? projectileSummary(authoritative) : '0 projectiles present.',
    authoritative ? `Arena radius ${radiusBand(authoritative.arena.radius)}, shrink phase ${authoritative.arena.shrinkPhase}.` : 'Arena unavailable.',
    local ? `Shot ${cooldownState(local.cooldownTicks)}; ${local.dashAvailable ? 'dash available' : 'dash used'}.` : 'Local combat state unavailable.',
    finalizationFailed ? 'Outcome unavailable.' : `Outcome: ${outcome}.`,
  ].join(' ');
  const handleClose = () => {
    input.release();
    if (ended) onClose();
    else onForfeit();
  };

  return (
    <section className={`arena-board glass-panel animate-slide-up ${styles.board}`} data-testid="arena-board">
      <button
        className="modal-close"
        onClick={handleClose}
        aria-label={ended ? 'Close arena' : 'Forfeit arena'}
        disabled={finalizationPending}
        aria-disabled={finalizationPending || undefined}
      >
        <Icon name="x" />
      </button>
      <header className={`modal-header ${styles.header}`}>
        <div className={styles.titleBlock}>
          <h2 className="heading-title modal-title">Arena Knockoff</h2>
          <p className="modal-subtitle">{roundLabel}</p>
        </div>
        <div className={styles.hud}>
          <span data-testid="arena-score" className={styles.score}>{score[0]} – {score[1]}</span>
          <span>{phase}{authoritative?.phaseEndsAtTick == null ? '' : ` · ${countdownSeconds}s`}</span>
          <Tooltip content="Arena audio arrives in a later release" delay={0}>
            <button className={`btn btn-secondary btn-sm ${styles.audio}`} aria-disabled="true" aria-label="Arena audio unavailable" onClick={event => event.preventDefault()}>
              <Icon name="headphones-off" />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className={styles.canvasBox}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      </div>
      <div className="sr-only" data-testid="arena-live-region" role="status" aria-live="polite">{liveText}</div>
    </section>
  );
}
