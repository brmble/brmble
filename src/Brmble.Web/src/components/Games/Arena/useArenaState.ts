import { useEffect, useRef, useState } from 'react';
import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaProjectileSnapshot, ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome,
} from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import { constrainLocalDisplay, reconcile, sampleTimeline, stepLocal, type PredictedArenaState } from './arenaMath';
import {
  detectKnockout, sampleKnockout, KNOCKOUT_DURATION_MS, type ArenaKnockout, type ArenaKnockoutFrame,
} from './arenaKnockout';
import { createServerClock, type ServerClock } from './serverClock';

interface UseArenaStateOptions {
  welcome: ArenaWelcome | null;
  latestSnapshot: ArenaSnapshot | null;
  pendingInputs: PendingArenaInput[];
  currentInput?: ArenaInputState;
  selfSessionId: number;
  finalState?: ArenaStateSnapshot;
  reducedMotion?: boolean;
  /**
   * Converts this client's wall clock to the server's. Snapshots are stamped with
   * the server's clock, so the timeline must be sampled in server time; sampling it
   * with a raw `Date.now()` slides the render point off the interpolation buffer by
   * however far the two machines disagree. Defaults to an uncalibrated clock — zero
   * offset, i.e. the two clocks assumed identical — which is correct only when they
   * genuinely are, as in a test or a single-machine dev loop. Production callers
   * pass the one `useArenaConnection` samples from real traffic.
   */
  serverClock?: ServerClock;
  /**
   * The client's current local tick, from `useArenaConnection`: the tick its frames
   * are stamped with. Pending intervals are replayed through it, so the local state
   * after a reconcile sits at the same tick the next input will be stamped with.
   * Without it the newest interval is replayed only to its own stamp, which is the
   * pre-scheduling behaviour and what the tests without a connection exercise.
   */
  currentPredictedTick?: () => number;
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
  /** Presentation only, and empty when nothing is animating. */
  knockout: ArenaKnockoutFrame[];
}

const emptyState: ArenaRenderState = {
  localPlayer: null, remotePlayer: null, projectiles: [], arena: null, phase: null,
  phaseEndsAtTick: null, score: [0, 0], consecutiveDoubleKos: 0, snapCount: 0, knockout: [],
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

function asSnapshot(
  welcome: ArenaWelcome, state = welcome.state, generatedAtUnixMs = welcome.generatedAtUnixMs,
): ArenaSnapshot {
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
    knockout: [],
  };
}

export function useArenaState({
  welcome, latestSnapshot, pendingInputs, currentInput = neutralInput, selfSessionId, finalState,
  reducedMotion = false, serverClock, currentPredictedTick, onFrame,
}: UseArenaStateOptions): ArenaRenderState {
  // One fallback instance per hook, never shared: a module-level singleton would let
  // one match's samples leak into another's.
  const fallbackClockRef = useRef<ServerClock | null>(null);
  fallbackClockRef.current ??= createServerClock();
  const serverClockRef = useRef<ServerClock>(serverClock ?? fallbackClockRef.current);
  serverClockRef.current = serverClock ?? fallbackClockRef.current;
  const [rendered, setRendered] = useState<ArenaRenderState>(emptyState);
  const timelineRef = useRef<ArenaSnapshot[]>([]);
  const predictedRef = useRef<PredictedArenaState | undefined>(undefined);
  // `snappedRef` latches the previous frame's snap state so `snapCount` counts snap
  // *streaks*, not snap frames. Note the precondition when asserting on it: if a
  // fixture starts in deep overlap (separation below the `deeplyOverlapping`
  // threshold), `invalidPosition` fires on every frame including the RAF loop's
  // first synchronous frame — where `predictedRef` is still undefined, so the
  // increment is skipped but `snappedRef` latches true. `snapCount` is then pinned
  // at 0 regardless of correctness, and asserting `snapCount === 0` is vacuous.
  // Such an assertion is only meaningful when the fixture does not begin in deep overlap.
  const snapCountRef = useRef(0);
  const welcomeRef = useRef<ArenaWelcome | null>(null);
  const correctionRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const snappedRef = useRef(false);
  const inputsRef = useRef({ pendingInputs, currentInput, selfSessionId, finalState });
  const authorityDirtyRef = useRef(true);
  const inputDirtyRef = useRef(true);
  const inputKeyRef = useRef('');
  const sessionRef = useRef(selfSessionId);
  // The blended display position with its sub-tick interpolation removed, so the
  // correction origin is a tick-aligned base measured against `local.player`,
  // which is also a tick-aligned base. Comparing a base against an interpolated
  // display would count the sub-tick offset twice once the phase is preserved.
  const renderedBaseRef = useRef<ArenaPlayerSnapshot | null>(null);
  const presentedRef = useRef<PredictedArenaState | undefined>(undefined);
  const presentedAtRef = useRef(0);
  const suppressedInputsRef = useRef<{ pending: PendingArenaInput[] } | null>(null);
  // Presentation only. Nothing sampled from this ref is ever written back into
  // prediction, presentation or authority state — it is read once per frame to
  // build `nextRendered.knockout` and nowhere else.
  const knockoutRef = useRef<ArenaKnockout | null>(null);
  // The knockout is inferred from a snapshot *pair*, so the previously reconciled
  // authority is held rather than derived: deriving it from the timeline would
  // compare the newest snapshot against itself and never detect anything.
  const previousAuthorityRef = useRef<ArenaStateSnapshot | null>(null);
  // The board the round was decided on, held for the duration of the fall so the
  // arena and the survivor do not snap to their reset positions mid-animation.
  const frozenBoardRef = useRef<ArenaStateSnapshot | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const currentPredictedTickRef = useRef(currentPredictedTick);
  currentPredictedTickRef.current = currentPredictedTick;

  useEffect(() => {
    if (sessionRef.current !== selfSessionId) {
      sessionRef.current = selfSessionId;
      suppressedInputsRef.current = { pending: pendingInputs };
      predictedRef.current = undefined;
      presentedRef.current = undefined;
      presentedAtRef.current = 0;
      renderedBaseRef.current = null;
      correctionRef.current = null;
      knockoutRef.current = null;
      previousAuthorityRef.current = null;
      frozenBoardRef.current = null;
      snappedRef.current = false;
      snapCountRef.current = 0;
      authorityDirtyRef.current = true;
    }
    const suppressed = suppressedInputsRef.current;
    const usePending = suppressed?.pending === pendingInputs ? [] : pendingInputs;
    if (suppressed && suppressed.pending !== pendingInputs) {
      suppressedInputsRef.current = null;
    }
    inputsRef.current = { pendingInputs: usePending, currentInput, selfSessionId, finalState };
    const inputKey = JSON.stringify(
      usePending.filter(input => input.input.fireReleased || input.input.dash)
        .map(input => [input.sequence, input.input.fireReleased, input.input.dash]),
    );
    if (inputKey !== inputKeyRef.current) {
      inputKeyRef.current = inputKey;
      inputDirtyRef.current = true;
    }
    if (finalState) authorityDirtyRef.current = true;
    // No dependency array: this effect must run after EVERY render, not only when
    // its inputs change by identity. The welcome effect runs after it in the same
    // commit and clears `inputKeyRef`, so the ref is left out of step with the key
    // computed here; the re-run on the next render is what resyncs it and raises the
    // dirty flag that reconciles the first frame of a new match. It also means a
    // pending interval that grows without adding a fire or dash edge - ordinary held
    // movement, which the key deliberately ignores - still reaches `inputsRef` in
    // time for the next frame.
    //
    // This used to happen by accident: `recentInputs` defaulted to a fresh `[]` on
    // every render, so the dependency array changed every render. Removing that
    // unused parameter removed the accident, and four tests across cadence,
    // reconciliation and input-only targets went red in two different directions.
    // The cadence is load-bearing, so it is now stated rather than inherited.
    //
    // Follow-up worth taking deliberately: `inputKey` tracks only fire and dash
    // edges, so nothing else can mark input dirty on its own. That is why this has
    // to run unconditionally, and it is a thin contract to rest on.
  });
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
    presentedAtRef.current = 0;
    renderedBaseRef.current = null;
    correctionRef.current = null;
    knockoutRef.current = null;
    previousAuthorityRef.current = null;
    frozenBoardRef.current = null;
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
              correctionOrigin: authorityChanged ? correctionOrigin : undefined,
            },
            current.finalState ? [] : current.pendingInputs,
            welcome.prediction,
            current.finalState ? undefined : currentPredictedTickRef.current?.(),
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
          // reconcile has already replayed. Only a mandatory snap resets the phase,
          // and a snap is only mandatory when authority changed: on an input-only
          // reconcile `snapped` merely reports that replaying newly added pending
          // inputs moved further than the correction threshold, which is ordinary
          // local movement, not a discontinuity.
          const phaseMs = predictedRef.current && !(authorityChanged && result.snapped)
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
          // Server time, not client time. `generatedAtUnixMs` on every frame in the
          // timeline comes from the server's clock, so the render point has to be
          // expressed in that clock or the 100 ms buffer means whatever the offset
          // between the two machines happens to be.
          : sampleTimeline(
              timeline, serverClockRef.current.now(Date.now()),
              welcome.interpolationMs, welcome.maxExtrapolationMs,
            );
        const correction = correctionRef.current;
        const remaining = correction ? Math.max(0, 1 - (frameTime - correction.startedAt) / 100) : 0;
        const local = correction ? {
          ...interpolatedPlayer,
          x: Math.trunc(interpolatedPlayer.x - correction.x * remaining),
          y: Math.trunc(interpolatedPlayer.y - correction.y * remaining),
        } : interpolatedPlayer;
        renderedBaseRef.current = {
          ...local,
          x: local.x - (interpolatedPlayer.x - presented.player.x),
          y: local.y - (interpolatedPlayer.y - presented.player.y),
        };
        const remote = sampled.players.find(player => player.sessionId !== current.selfSessionId) ?? null;
        // Display filter only, applied once per frame after the correction blend and
        // never written back. `renderedBaseRef` above keeps the unconstrained position
        // because it is the correction origin for the next reconcile; feeding the
        // constrained position back would measure prediction against a client-only
        // display artefact and oscillate against the constraint.
        const displayedLocal = constrainLocalDisplay(
          local, remote, welcome.prediction.playerRadius, sampled.arena.radius,
        );
        const predictedProjectiles = presented.projectiles.filter(projectile => projectile.id < 0);
        // Deliberately ungated: a frame where authority did not change compares the
        // snapshot against itself, and `detectKnockout` is null for every such pair
        // (live/live fails its next-phase guard, any other phase fails its
        // previous-phase guard). An `authorityChanged` gate here would be an
        // unpinnable branch — no test can distinguish it — so there is no branch.
        //
        // Known limit: holding a pair rather than walking the timeline means a whole
        // live -> loading -> live cycle completing inside one frame is invisible, since
        // the pair reads live -> live. Unreachable in practice — round transitions are
        // hundreds of milliseconds against a 60 Hz loop — and closing it would mean
        // scanning the timeline, which is far more machinery than the case warrants.
        //
        // Known limit, deliberately deferred: detection reads `authority` — the
        // newest snapshot — but everything drawn comes from `sampled`, the timeline
        // interpolated at `Date.now() - interpolationMs`, roughly 100-150 ms behind.
        // So at the instant the animation arms, the victim's normal draw is
        // suppressed and the falling body appears at the *last-snapshot* position,
        // up to ~150 ms of travel further out: the body pops forward one frame and
        // then slides. It is largest on high-velocity knockouts, which is exactly
        // where it is most visible. Not fixed here because both remedies — changing
        // which snapshot detection reads, or applying a compensating offset — are
        // design changes on unvalidated ground, and the pop is always *outward* so
        // it may well read as acceleration rather than as an error. This is the top
        // item for manual validation; measure before changing it.
        const detected = detectKnockout(previousAuthorityRef.current, authority, frameTime);
        if (detected !== null) {
          knockoutRef.current = detected;
          // The server resets the round in the same tick it rules the knockout, so the
          // next snapshot already carries the full ring and both players respawned.
          // Hold the board the round was actually decided on until the fall finishes,
          // otherwise a knockout from a shrunken arena plays out across a full-size one.
          // Display only: the frozen values are published, never fed back.
          frozenBoardRef.current = previousAuthorityRef.current;
        }
        previousAuthorityRef.current = authority;
        if (knockoutRef.current !== null
          && frameTime - knockoutRef.current.startedAt > KNOCKOUT_DURATION_MS) {
          knockoutRef.current = null;
          frozenBoardRef.current = null;
        }
        const knockout = knockoutRef.current === null ? [] : sampleKnockout(
          knockoutRef.current, frameTime, welcome.prediction.playerRadius, reducedMotion,
        );
        const frozen = frozenBoardRef.current;
        const frozenLocal = frozen?.players.find(player => player.sessionId === current.selfSessionId);
        const frozenRemote = frozen?.players.find(player => player.sessionId !== current.selfSessionId);
        const nextRendered: ArenaRenderState = {
          localPlayer: frozenLocal ?? displayedLocal, remotePlayer: frozenRemote ?? remote,
          projectiles: [...sampled.projectiles, ...predictedProjectiles],
          arena: frozen?.arena ?? sampled.arena, phase: sampled.phase, phaseEndsAtTick: sampled.phaseEndsAtTick,
          score: [sampled.score[0], sampled.score[1]], consecutiveDoubleKos: sampled.consecutiveDoubleKos,
          snapCount: snapCountRef.current,
          knockout,
        };
        onFrameRef.current?.(nextRendered);
        if (predictionChanged) setRendered(nextRendered);
      }
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
    // `reducedMotion` is a dependency rather than a ref so that it is never read stale
    // from this closure. Restarting the loop on an OS accessibility toggle costs one
    // extra synchronous `update()`; every ref above it survives, so nothing resets.
    // The setting is owned by ArenaBoard — the hook must not open a second matchMedia
    // listener for it.
  }, [reducedMotion, welcome]);

  useEffect(() => {
    if (!welcome && finalState) onFrameRef.current?.(renderFinalState(finalState, selfSessionId));
  }, [finalState, selfSessionId, welcome]);

  if (!welcome && finalState) {
    return renderFinalState(finalState, selfSessionId);
  }
  return welcome ? rendered : emptyState;
}
