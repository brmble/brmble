import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../Icon/Icon';
import { Tooltip } from '../../Tooltip/Tooltip';
import type { ArenaMatchClosed, ArenaPhase, ArenaPlayerSnapshot } from './arenaProtocol';
import { ArenaRenderer } from './ArenaRenderer';
import { useArenaConnection } from './useArenaConnection';
import { useArenaState } from './useArenaState';
import styles from './ArenaBoard.module.css';

interface ArenaBoardProps {
  matchId: number;
  selfSessionId: number;
  resolveName: (sessionId: number) => string;
  resolveAvatarUrl: (sessionId: number) => string | null | undefined;
  onForfeit: () => void;
  onClose: () => void;
  ended: ArenaMatchClosed | null;
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

export function ArenaBoard({
  matchId, selfSessionId, resolveName, resolveAvatarUrl, onForfeit, onClose, ended,
}: ArenaBoardProps) {
  const connection = useArenaConnection({ matchId, enabled: !ended });
  const state = useArenaState({
    welcome: connection.welcome, latestSnapshot: connection.latestSnapshot,
    pendingInputs: connection.pendingInputs, recentInputs: connection.recentInputs,
    selfSessionId, finalState: ended?.finalState,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const stateRef = useRef(state);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const renderFrame = () => {
      const current = stateRef.current;
      const players = [current.localPlayer, current.remotePlayer].filter((player): player is ArenaPlayerSnapshot => player !== null);
      if (current.arena) rendererRef.current?.render({
        selfSessionId, players, projectiles: current.projectiles, arena: current.arena,
        names: Object.fromEntries(players.map(player => [player.sessionId, resolveName(player.sessionId)])),
        avatarUrls: Object.fromEntries(players.map(player => [player.sessionId, resolveAvatarUrl(player.sessionId)])),
      }, { reducedMotion });
      frame = requestAnimationFrame(renderFrame);
    };
    renderFrame();
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, resolveAvatarUrl, resolveName, selfSessionId]);

  const players = [state.localPlayer, state.remotePlayer].filter((player): player is ArenaPlayerSnapshot => player !== null);
  const serverTick = connection.latestSnapshot?.serverTick ?? connection.welcome?.serverTick ?? 0;
  const countdownTicks = state.phaseEndsAtTick === null ? 0 : Math.max(0, state.phaseEndsAtTick - serverTick);
  const countdownSeconds = Math.ceil(countdownTicks / (connection.welcome?.tickRate ?? 60));
  const phase = state.phase ? phaseLabels[state.phase] : connection.status === 'connected' ? 'Loading' : connection.status;
  const round = state.score[0] + state.score[1] + 1;
  const local = state.localPlayer;
  const outcome = ended
    ? state.score[0] === state.score[1] ? 'Draw' : state.score[local?.side ?? 0] > state.score[(local?.side ?? 0) === 0 ? 1 : 0] ? 'Victory' : 'Defeat'
    : 'Match in progress';
  const liveText = [
    `${phase}${state.phaseEndsAtTick === null ? '' : `, ${countdownSeconds} ${countdownSeconds === 1 ? 'second' : 'seconds'} remaining`}.`,
    `Score ${state.score[0]} to ${state.score[1]}.`,
    ...players.map(player => `${resolveName(player.sessionId)}, side ${player.side + 1}, aim ${direction(player)}, charge ${chargeBand(player.chargePermille)}${player.forcedFireTicks === null ? '' : `, forced fire in ${player.forcedFireTicks} ticks`}.`),
    `${state.projectiles.length} ${state.projectiles.length === 1 ? 'projectile' : 'projectiles'} present.`,
    state.arena ? `Arena radius ${state.arena.radius}, shrink phase ${state.arena.shrinkPhase}.` : 'Arena unavailable.',
    local ? `Shot ${local.cooldownTicks > 0 ? `cooldown, ${local.cooldownTicks} ticks remaining` : 'ready'}; ${local.dashAvailable ? 'dash available' : 'dash used'}.` : 'Local combat state unavailable.',
    `Outcome: ${outcome}.`,
  ].join(' ');

  return (
    <section className={`arena-board glass-panel animate-slide-up ${styles.board}`}>
      <button className="modal-close" onClick={ended ? onClose : onForfeit} aria-label={ended ? 'Close arena' : 'Forfeit arena'}>
        <Icon name="x" size={20} />
      </button>
      <header className={`modal-header ${styles.header}`}>
        <div className={styles.titleBlock}>
          <h2 className="heading-title modal-title">Arena Knockoff</h2>
          <p className="modal-subtitle">Round {round}</p>
        </div>
        <div className={styles.hud}>
          <span data-testid="arena-score" className={styles.score}>{state.score[0]} – {state.score[1]}</span>
          <span>{phase}{state.phaseEndsAtTick === null ? '' : ` · ${countdownSeconds}s`}</span>
          <Tooltip content="Arena audio arrives in a later release">
            <button className={`btn btn-secondary btn-sm ${styles.audio}`} disabled aria-disabled="true" aria-label="Arena audio unavailable">
              <Icon name="headphones-off" size={16} />
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
