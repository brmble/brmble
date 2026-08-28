import { useEffect, useRef, useState } from 'react';
import type {
  ArenaPlayerSnapshot, ArenaProjectileSnapshot, ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome,
} from './arenaProtocol';
import type { PendingArenaInput, RecentArenaInput } from './useArenaConnection';
import { reconcile, sampleTimeline, type PredictedArenaState } from './arenaMath';

interface UseArenaStateOptions {
  welcome: ArenaWelcome | null;
  latestSnapshot: ArenaSnapshot | null;
  pendingInputs: PendingArenaInput[];
  recentInputs?: RecentArenaInput[];
  selfSessionId: number;
  finalState?: ArenaStateSnapshot;
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

function asSnapshot(welcome: ArenaWelcome, state = welcome.state, generatedAtUnixMs = Date.now()): ArenaSnapshot {
  return {
    type: 'snapshot', protocolVersion: 1, matchId: welcome.matchId,
    sequence: welcome.snapshotSequence, serverTick: welcome.serverTick, generatedAtUnixMs, ...state,
  };
}

export function useArenaState({
  welcome, latestSnapshot, pendingInputs, recentInputs = [], selfSessionId, finalState,
}: UseArenaStateOptions): ArenaRenderState {
  const [rendered, setRendered] = useState<ArenaRenderState>(emptyState);
  const timelineRef = useRef<ArenaSnapshot[]>([]);
  const predictedRef = useRef<PredictedArenaState | undefined>(undefined);
  const snapCountRef = useRef(0);
  const welcomeRef = useRef<ArenaWelcome | null>(null);
  const correctionRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const snappedRef = useRef(false);
  const inputsRef = useRef({ pendingInputs, recentInputs, selfSessionId, finalState });
  const authorityDirtyRef = useRef(true);
  const inputDirtyRef = useRef(true);
  const inputKeyRef = useRef('');
  const sessionRef = useRef(selfSessionId);
  const renderedLocalRef = useRef<ArenaPlayerSnapshot | null>(null);

  useEffect(() => {
    inputsRef.current = { pendingInputs, recentInputs, selfSessionId, finalState };
    if (sessionRef.current !== selfSessionId) {
      sessionRef.current = selfSessionId;
      predictedRef.current = undefined;
      renderedLocalRef.current = null;
      correctionRef.current = null;
      snappedRef.current = false;
      snapCountRef.current = 0;
      authorityDirtyRef.current = true;
    }
    const inputKey = JSON.stringify([pendingInputs, recentInputs]);
    if (inputKey !== inputKeyRef.current) {
      inputKeyRef.current = inputKey;
      inputDirtyRef.current = true;
    }
    if (finalState) authorityDirtyRef.current = true;
  }, [finalState, pendingInputs, recentInputs, selfSessionId]);

  useEffect(() => {
    if (!welcome) {
      timelineRef.current = [];
      predictedRef.current = undefined;
      snapCountRef.current = 0;
      correctionRef.current = null;
      snappedRef.current = false;
      authorityDirtyRef.current = false;
      inputDirtyRef.current = false;
      inputKeyRef.current = '';
      welcomeRef.current = null;
      return;
    }
    predictedRef.current = undefined;
    renderedLocalRef.current = null;
    correctionRef.current = null;
    snappedRef.current = false;
    snapCountRef.current = 0;
    authorityDirtyRef.current = true;
    inputDirtyRef.current = true;
    inputKeyRef.current = '';
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
    const update = () => {
      const timeline = timelineRef.current;
      if (timeline.length > 0) {
        const current = inputsRef.current;
        const authority = current.finalState
          ? asSnapshot(welcome, current.finalState)
          : timeline.reduce((latest, candidate) => candidate.sequence > latest.sequence ? candidate : latest);
        const authorityChanged = authorityDirtyRef.current || !predictedRef.current;
        if (authorityChanged || inputDirtyRef.current) {
          const result = reconcile(
            {
              snapshot: authority, selfSessionId: current.selfSessionId, previous: predictedRef.current,
              recentInputs: current.recentInputs,
              correctionOrigin: authorityChanged ? renderedLocalRef.current ?? undefined : undefined,
            },
            current.finalState ? [] : current.pendingInputs,
            welcome.prediction,
          );
          if (authorityChanged) {
            if (result.snapped && predictedRef.current && !snappedRef.current) snapCountRef.current++;
            snappedRef.current = result.snapped;
            correctionRef.current = result.correction
              ? { x: result.correction.x, y: result.correction.y, startedAt: Date.now() }
              : null;
          }
          predictedRef.current = result.local;
          authorityDirtyRef.current = false;
          inputDirtyRef.current = false;
        }
        const predicted = predictedRef.current;
        if (!predicted) throw new Error('Arena prediction was not initialized');
        const sampled = current.finalState
          ? authority
          : sampleTimeline(timeline, Date.now(), welcome.interpolationMs, welcome.maxExtrapolationMs);
        const correction = correctionRef.current;
        const remaining = correction ? Math.max(0, 1 - (Date.now() - correction.startedAt) / 100) : 0;
        const local = correction ? {
          ...predicted.player,
          x: Math.trunc(predicted.player.x - correction.x * remaining),
          y: Math.trunc(predicted.player.y - correction.y * remaining),
        } : predicted.player;
        renderedLocalRef.current = local;
        const remote = sampled.players.find(player => player.sessionId !== current.selfSessionId) ?? null;
        const predictedProjectiles = predicted.projectiles.filter(projectile => projectile.id < 0);
        setRendered({
          localPlayer: local, remotePlayer: remote, projectiles: [...sampled.projectiles, ...predictedProjectiles],
          arena: sampled.arena, phase: sampled.phase, phaseEndsAtTick: sampled.phaseEndsAtTick,
          score: [...sampled.score], consecutiveDoubleKos: sampled.consecutiveDoubleKos,
          snapCount: snapCountRef.current,
        });
      }
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [welcome]);

  return welcome ? rendered : emptyState;
}
