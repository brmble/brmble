import { useEffect, useRef, useState } from 'react';
import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaProjectileSnapshot, ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome,
} from './arenaProtocol';
import type { PendingArenaInput, RecentArenaInput } from './useArenaConnection';
import { reconcile, sampleTimeline, stepLocal, type PredictedArenaState } from './arenaMath';

interface UseArenaStateOptions {
  welcome: ArenaWelcome | null;
  latestSnapshot: ArenaSnapshot | null;
  pendingInputs: PendingArenaInput[];
  recentInputs?: RecentArenaInput[];
  currentInput?: ArenaInputState;
  selfSessionId: number;
  finalState?: ArenaStateSnapshot;
  onFrame?: (state: ArenaRenderState) => void;
}

interface ArenaRenderState {
  localPlayer: ArenaPlayerSnapshot | null;
  remotePlayer: ArenaPlayerSnapshot | null;
  projectiles: ArenaProjectileSnapshot[];
  arena: ArenaStateSnapshot['arena'] | null;
  phase: ArenaStateSnapshot['phase'] | null;
  phaseEndsAtTick: number | null;
  score: [number, number];
  consecutiveDoubleKos: number;
  snapCount: number;
}

const emptyState: ArenaRenderState = {
  localPlayer: null, remotePlayer: null, projectiles: [], arena: null, phase: null,
  phaseEndsAtTick: null, score: [0, 0], consecutiveDoubleKos: 0, snapCount: 0,
};
const neutralInput: ArenaInputState = {
  moveX: 0, moveY: 0, aimX: 32767, aimY: 0,
  charging: false, fireReleased: false, dash: false,
};

export function advanceLocalPresentation(
  state: PredictedArenaState,
  input: ArenaInputState,
  elapsedMs: number,
  tickRate: number,
  constants: ArenaWelcome['prediction'],
): { state: PredictedArenaState; elapsedTicks: number } {
  const elapsedTicks = Math.min(3, Math.max(0, Math.floor(elapsedMs * tickRate / 1000)));
  const heldInput = { ...input, fireReleased: false, dash: false };
  let advanced = state;
  for (let tick = 0; tick < elapsedTicks; tick++) advanced = stepLocal(advanced, heldInput, constants);
  return { state: advanced, elapsedTicks };
}

export function interpolateLocalPresentation(
  state: PredictedArenaState,
  input: ArenaInputState,
  elapsedMs: number,
  tickRate: number,
  constants: ArenaWelcome['prediction'],
): ArenaPlayerSnapshot {
  if (state.phase === 'awaitingParticipants' || state.phase === 'loading' || state.phase === 'ended') {
    return state.player;
  }
  const fraction = Math.min(1, Math.max(0, elapsedMs * tickRate / 1000));
  if (fraction === 0) return state.player;
  const next = stepLocal(state, { ...input, fireReleased: false, dash: false }, constants);
  return {
    ...state.player,
    x: Math.trunc(state.player.x + (next.player.x - state.player.x) * fraction),
    y: Math.trunc(state.player.y + (next.player.y - state.player.y) * fraction),
  };
}

function asSnapshot(welcome: ArenaWelcome, state = welcome.state, generatedAtUnixMs = Date.now()): ArenaSnapshot {
  return {
    type: 'snapshot', protocolVersion: 1, matchId: welcome.matchId,
    sequence: welcome.snapshotSequence, serverTick: welcome.serverTick, generatedAtUnixMs, ...state,
  };
}

function renderFinalState(finalState: ArenaStateSnapshot, selfSessionId: number): ArenaRenderState {
  return {
    localPlayer: finalState.players.find(player => player.sessionId === selfSessionId) ?? null,
    remotePlayer: finalState.players.find(player => player.sessionId !== selfSessionId) ?? null,
    projectiles: finalState.projectiles,
    arena: finalState.arena,
    phase: finalState.phase,
    phaseEndsAtTick: finalState.phaseEndsAtTick,
    score: [finalState.score[0], finalState.score[1]],
    consecutiveDoubleKos: finalState.consecutiveDoubleKos,
    snapCount: 0,
  };
}

export function useArenaState({
  welcome, latestSnapshot, pendingInputs, recentInputs = [], currentInput = neutralInput, selfSessionId, finalState, onFrame,
}: UseArenaStateOptions): ArenaRenderState {
  const [rendered, setRendered] = useState<ArenaRenderState>(emptyState);
  const timelineRef = useRef<ArenaSnapshot[]>([]);
  const predictedRef = useRef<PredictedArenaState | undefined>(undefined);
  const snapCountRef = useRef(0);
  const welcomeRef = useRef<ArenaWelcome | null>(null);
  const correctionRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const snappedRef = useRef(false);
  const inputsRef = useRef({ pendingInputs, recentInputs, currentInput, selfSessionId, finalState });
  const authorityDirtyRef = useRef(true);
  const inputDirtyRef = useRef(true);
  const inputKeyRef = useRef('');
  const sessionRef = useRef(selfSessionId);
  const renderedLocalRef = useRef<ArenaPlayerSnapshot | null>(null);
  // The blended display position with its sub-tick interpolation removed, so the
  // correction origin is a tick-aligned base measured against `local.player`,
  // which is also a tick-aligned base. Comparing a base against an interpolated
  // display would count the sub-tick offset twice once the phase is preserved.
  const renderedBaseRef = useRef<ArenaPlayerSnapshot | null>(null);
  const presentedRef = useRef<PredictedArenaState | undefined>(undefined);
  const presentedAtRef = useRef(0);
  const suppressedInputsRef = useRef<{ pending: PendingArenaInput[]; recent: RecentArenaInput[] } | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (sessionRef.current !== selfSessionId) {
      sessionRef.current = selfSessionId;
      suppressedInputsRef.current = { pending: pendingInputs, recent: recentInputs };
      predictedRef.current = undefined;
      presentedRef.current = undefined;
      renderedLocalRef.current = null;
      renderedBaseRef.current = null;
      correctionRef.current = null;
      snappedRef.current = false;
      snapCountRef.current = 0;
      authorityDirtyRef.current = true;
    }
    const suppressed = suppressedInputsRef.current;
    const usePending = suppressed?.pending === pendingInputs ? [] : pendingInputs;
    const useRecent = suppressed?.recent === recentInputs ? [] : recentInputs;
    if (suppressed && suppressed.pending !== pendingInputs && suppressed.recent !== recentInputs) {
      suppressedInputsRef.current = null;
    }
    inputsRef.current = { pendingInputs: usePending, recentInputs: useRecent, currentInput, selfSessionId, finalState };
    const inputKey = JSON.stringify([
      usePending.filter(input => input.input.fireReleased || input.input.dash)
        .map(input => [input.sequence, input.input.fireReleased, input.input.dash]),
      useRecent.filter(input => input.input.fireReleased || input.input.dash)
        .map(input => [input.sequence, input.input.fireReleased, input.input.dash]),
    ]);
    if (inputKey !== inputKeyRef.current) {
      inputKeyRef.current = inputKey;
      inputDirtyRef.current = true;
    }
    if (finalState) authorityDirtyRef.current = true;
  }, [finalState, pendingInputs, recentInputs, selfSessionId]);
  inputsRef.current.currentInput = currentInput;

  useEffect(() => {
    if (!welcome) {
      timelineRef.current = [];
      predictedRef.current = undefined;
      presentedRef.current = undefined;
      snapCountRef.current = 0;
      correctionRef.current = null;
      snappedRef.current = false;
      authorityDirtyRef.current = false;
      inputDirtyRef.current = false;
      inputKeyRef.current = '';
      suppressedInputsRef.current = null;
      welcomeRef.current = null;
      return;
    }
    predictedRef.current = undefined;
    presentedRef.current = undefined;
    renderedLocalRef.current = null;
    renderedBaseRef.current = null;
    correctionRef.current = null;
    snappedRef.current = false;
    snapCountRef.current = 0;
    authorityDirtyRef.current = true;
    inputDirtyRef.current = true;
    inputKeyRef.current = '';
    suppressedInputsRef.current = null;
    welcomeRef.current = welcome;
    const frame = asSnapshot(welcome);
    timelineRef.current = [frame];
  }, [welcome]);

  useEffect(() => {
    if (!welcome || !latestSnapshot || latestSnapshot.matchId !== welcome.matchId) return;
    const newest = timelineRef.current.reduce((sequence, frame) => Math.max(sequence, frame.sequence), -1);
    if (latestSnapshot.sequence <= newest) return;
    timelineRef.current = [...timelineRef.current, latestSnapshot]
      .sort((left, right) => left.generatedAtUnixMs - right.generatedAtUnixMs || left.sequence - right.sequence)
      .slice(-20);
    authorityDirtyRef.current = true;
  }, [latestSnapshot, welcome]);

  useEffect(() => {
    if (!welcome) return;
    let frameId = 0;
    const update = (frameTime = performance.now()) => {
      const timeline = timelineRef.current;
      if (timeline.length > 0) {
        const current = inputsRef.current;
        const authority = current.finalState
          ? asSnapshot(welcome, current.finalState)
          : timeline.reduce((latest, candidate) => candidate.sequence > latest.sequence ? candidate : latest);
        const authorityChanged = authorityDirtyRef.current || !predictedRef.current;
        const predictionChanged = authorityChanged || inputDirtyRef.current;
        if (predictionChanged) {
          // The correction origin must be measured at this frame, not the last
          // one. Reconcile's base already includes the whole ticks the phase
          // clock consumed since the previous presented tick, so the origin has
          // to advance by those same ticks or the correction cancels them out
          // and the display steps backward by one tick on the reconcile frame.
          const previousBase = presentedRef.current;
          const originBase = renderedBaseRef.current;
          let correctionOrigin = originBase ?? undefined;
          if (authorityChanged && previousBase && originBase) {
            const advancedOrigin = advanceLocalPresentation(
              previousBase, current.currentInput, frameTime - presentedAtRef.current,
              welcome.tickRate, welcome.prediction,
            );
            correctionOrigin = {
              ...originBase,
              x: originBase.x + (advancedOrigin.state.player.x - previousBase.player.x),
              y: originBase.y + (advancedOrigin.state.player.y - previousBase.player.y),
            };
          }
          const result = reconcile(
            {
              snapshot: authority, selfSessionId: current.selfSessionId, previous: predictedRef.current,
              recentInputs: current.recentInputs,
              correctionOrigin: authorityChanged ? correctionOrigin : undefined,
            },
            current.finalState ? [] : current.pendingInputs,
            welcome.prediction,
          );
          const tickMs = 1000 / welcome.tickRate;
          if (authorityChanged) {
            if (result.snapped && predictedRef.current && !snappedRef.current) snapCountRef.current++;
            snappedRef.current = result.snapped;
            correctionRef.current = result.correction
              ? { x: result.correction.x, y: result.correction.y, startedAt: frameTime }
              : null;
          }
          // The local tick-phase clock is monotonic. Reconcile supplies completed
          // ticks; the phase clock supplies only the remainder within the current
          // tick. Carrying the whole elapsed time would double-apply ticks that
          // reconcile has already replayed. Only a mandatory snap resets the phase.
          const phaseMs = predictedRef.current && !result.snapped
            ? Math.max(0, (frameTime - presentedAtRef.current) % tickMs)
            : 0;
          predictedRef.current = result.local;
          presentedRef.current = result.local;
          presentedAtRef.current = frameTime - phaseMs;
          authorityDirtyRef.current = false;
          inputDirtyRef.current = false;
        }
        const predicted = predictedRef.current;
        if (!predicted) throw new Error('Arena prediction was not initialized');
        let presented = presentedRef.current ?? predicted;
        if (!current.finalState && presented.phase !== 'awaitingParticipants'
          && presented.phase !== 'loading' && presented.phase !== 'ended') {
          const advanced = advanceLocalPresentation(
            presented, current.currentInput, frameTime - presentedAtRef.current,
            welcome.tickRate, welcome.prediction,
          );
          presented = advanced.state;
          const { elapsedTicks } = advanced;
          if (elapsedTicks > 0) {
            presentedRef.current = presented;
            presentedAtRef.current += elapsedTicks * 1000 / welcome.tickRate;
          }
        }
        const interpolatedPlayer = current.finalState ? presented.player : interpolateLocalPresentation(
          presented, current.currentInput, frameTime - presentedAtRef.current,
          welcome.tickRate, welcome.prediction,
        );
        const sampled = current.finalState
          ? authority
          : sampleTimeline(timeline, Date.now(), welcome.interpolationMs, welcome.maxExtrapolationMs);
        const correction = correctionRef.current;
        const remaining = correction ? Math.max(0, 1 - (frameTime - correction.startedAt) / 100) : 0;
        const local = correction ? {
          ...interpolatedPlayer,
          x: Math.trunc(interpolatedPlayer.x - correction.x * remaining),
          y: Math.trunc(interpolatedPlayer.y - correction.y * remaining),
        } : interpolatedPlayer;
        renderedLocalRef.current = local;
        renderedBaseRef.current = {
          ...local,
          x: local.x - (interpolatedPlayer.x - presented.player.x),
          y: local.y - (interpolatedPlayer.y - presented.player.y),
        };
        const remote = sampled.players.find(player => player.sessionId !== current.selfSessionId) ?? null;
        const predictedProjectiles = presented.projectiles.filter(projectile => projectile.id < 0);
        const nextRendered: ArenaRenderState = {
          localPlayer: local, remotePlayer: remote, projectiles: [...sampled.projectiles, ...predictedProjectiles],
          arena: sampled.arena, phase: sampled.phase, phaseEndsAtTick: sampled.phaseEndsAtTick,
          score: [sampled.score[0], sampled.score[1]], consecutiveDoubleKos: sampled.consecutiveDoubleKos,
          snapCount: snapCountRef.current,
        };
        onFrameRef.current?.(nextRendered);
        if (predictionChanged) setRendered(nextRendered);
      }
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [welcome]);

  useEffect(() => {
    if (!welcome && finalState) onFrameRef.current?.(renderFinalState(finalState, selfSessionId));
  }, [finalState, selfSessionId, welcome]);

  if (!welcome && finalState) {
    return renderFinalState(finalState, selfSessionId);
  }
  return welcome ? rendered : emptyState;
}
