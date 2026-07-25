import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';

export type DuelQueueSnapshot = gamesApi.DuelQueueSnapshot;

export interface RematchOffer {
  offerId: number;
  sourceMatchId: number;
  reservationId?: number;
  fromUserId?: number;
  fromSessionId?: number;
  toUserId?: number;
  toSessionId?: number;
  gameType?: string;
  format?: string;
  rulesetVersion?: number;
  options?: Record<string, unknown>;
  expiresAt?: string;
  inviteMs?: number;
}

export interface DuelQueueState {
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>;
  incomingRematch: RematchOffer | null;
  outgoingRematch: RematchOffer | null;
  commandError: DuelCommandError | null;
  respondReady: (reservationId: number, ready: boolean) => void;
  requestRematch: (sourceMatchId: number) => void;
  respondOffer: (offerId: number, accept: boolean) => void;
  cancelOffer: (offerId: number) => void;
  requestSnapshot: () => Promise<void>;
  reset: () => void;
}

export interface DuelCommandError {
  revision: number;
  operation: 'ready' | 'respondOffer' | 'requestRematch';
  id: number;
  reason?: string;
}

function validateRecoverySnapshot(
  value: unknown,
  expectedChannelId: number | null,
  currentChannelId: number | null,
): { snapshot: DuelQueueSnapshot; generatedAt: number } | null {
  if (value == null || typeof value !== 'object') return null;
  const snapshot = value as Partial<DuelQueueSnapshot>;
  const generatedAt = typeof snapshot.generatedAt === 'string' ? Date.parse(snapshot.generatedAt) : NaN;
  if (snapshot.schemaVersion !== 1
    || typeof snapshot.channelId !== 'number'
    || typeof snapshot.generation !== 'number'
    || typeof snapshot.revision !== 'number'
    || !Number.isFinite(generatedAt)
    || !Array.isArray(snapshot.queue)
    || (snapshot.active != null && !Array.isArray(snapshot.active.players))
    || (snapshot.readyCheck != null && !Array.isArray(snapshot.readyCheck.players))
    || snapshot.queue.some(item => item == null || !Array.isArray(item.players) || !Array.isArray(item.eta?.segments))
    || (expectedChannelId != null && snapshot.channelId !== expectedChannelId)
    || (currentChannelId != null && snapshot.channelId !== currentChannelId)) return null;
  return { snapshot: snapshot as DuelQueueSnapshot, generatedAt };
}

export function useDuelQueueState(): DuelQueueState {
  const [byChannel, setByChannel] = useState<Map<number, DuelQueueSnapshot>>(() => new Map());
  const [incomingRematch, setIncomingRematch] = useState<RematchOffer | null>(null);
  const [outgoingRematch, setOutgoingRematch] = useState<RematchOffer | null>(null);
  const [commandError, setCommandError] = useState<DuelCommandError | null>(null);
  const commandErrorRevisionRef = useRef(0);
  const deniedChannelIdsRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  const requestEpochRef = useRef(0);
  const currentChannelIdRef = useRef<number | null>(null);
  const acceptingSnapshotsRef = useRef(false);
  const versionsRef = useRef(new Map<number, Pick<DuelQueueSnapshot, 'generation' | 'revision'>>());
  const recoveryBaselinesRef = useRef(new Map<number, {
    generatedAt: number;
    generation: number;
    revision: number;
  }>());
  const recoveryStatusRef = useRef(new Map<number, 'recovering' | 'recovered'>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const requestSnapshotRef = useRef<() => Promise<void>>(async () => {});

  const cancelRecovery = useCallback(() => {
    if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    inFlightRef.current = null;
    requestEpochRef.current++;
  }, []);

  const applySnapshot = useCallback((snapshot: DuelQueueSnapshot) => {
    if (!acceptingSnapshotsRef.current
      || currentChannelIdRef.current == null
      || snapshot.channelId !== currentChannelIdRef.current
      || snapshot.schemaVersion !== 1
      || recoveryStatusRef.current.get(snapshot.channelId) !== 'recovered'
      || deniedChannelIdsRef.current.has(snapshot.channelId)) return;
    const generatedAt = Date.parse(snapshot.generatedAt);
    if (!Number.isFinite(generatedAt)) return;
    const recoveryBaseline = recoveryBaselinesRef.current.get(snapshot.channelId);
    if (recoveryBaseline && generatedAt < recoveryBaseline.generatedAt) return;
    const version = versionsRef.current.get(snapshot.channelId);
    if (version && (snapshot.generation < version.generation
      || (snapshot.generation === version.generation && snapshot.revision <= version.revision))) return;
    versionsRef.current.set(snapshot.channelId, {
      generation: snapshot.generation,
      revision: snapshot.revision,
    });
    setByChannel(previous => {
      const next = new Map(previous);
      next.set(snapshot.channelId, snapshot);
      return next;
    });
  }, []);

  const requestSnapshot = useCallback((): Promise<void> => {
    if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    if (inFlightRef.current) return inFlightRef.current;
    acceptingSnapshotsRef.current = true;
    const epoch = ++requestEpochRef.current;
    const requestedChannelId = currentChannelIdRef.current;
    if (requestedChannelId != null) recoveryStatusRef.current.set(requestedChannelId, 'recovering');
    let request!: Promise<void>;
    request = (async () => {
      const scheduleRetry = () => {
        if (mountedRef.current && requestEpochRef.current === epoch && retryTimerRef.current == null) {
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            void requestSnapshotRef.current();
          }, 1000);
        }
      };
      try {
        const response: unknown = await gamesApi.getQueueSnapshot();
        if (!mountedRef.current || requestEpochRef.current !== epoch) return;
        const validated = validateRecoverySnapshot(response, requestedChannelId, currentChannelIdRef.current);
        if (!validated) {
          scheduleRetry();
          return;
        }
        const { snapshot, generatedAt } = validated;
        currentChannelIdRef.current = snapshot.channelId;
        deniedChannelIdsRef.current.delete(snapshot.channelId);
        versionsRef.current.set(snapshot.channelId, {
          generation: snapshot.generation,
          revision: snapshot.revision,
        });
        recoveryBaselinesRef.current.set(snapshot.channelId, {
          generatedAt,
          generation: snapshot.generation,
          revision: snapshot.revision,
        });
        recoveryStatusRef.current.set(snapshot.channelId, 'recovered');
        setByChannel(new Map([[snapshot.channelId, snapshot]]));
      } catch {
        scheduleRetry();
      } finally {
        if (inFlightRef.current === request) inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
  }, []);
  requestSnapshotRef.current = requestSnapshot;

  useEffect(() => {
    mountedRef.current = true;
    const handleSnapshot = (data: unknown) => applySnapshot(data as DuelQueueSnapshot);
    const handleConnected = (data: unknown) => {
      const { channelId } = data as { channelId?: number };
      cancelRecovery();
      acceptingSnapshotsRef.current = true;
      currentChannelIdRef.current = channelId ?? null;
      deniedChannelIdsRef.current.clear();
      if (channelId != null) {
        recoveryBaselinesRef.current.delete(channelId);
        recoveryStatusRef.current.set(channelId, 'recovering');
      }
    };
    const handleChannelChanged = (data: unknown) => {
      const d = data as { channelId?: number; previousChannelId?: number };
      if (!acceptingSnapshotsRef.current) return;
      cancelRecovery();
      if (d.previousChannelId != null && d.previousChannelId !== d.channelId) {
        deniedChannelIdsRef.current.add(d.previousChannelId);
        setByChannel(previous => {
          if (!previous.has(d.previousChannelId!)) return previous;
          const next = new Map(previous);
          next.delete(d.previousChannelId!);
          return next;
        });
      }
      if (d.channelId != null) {
        currentChannelIdRef.current = d.channelId;
        deniedChannelIdsRef.current.delete(d.channelId);
        recoveryBaselinesRef.current.delete(d.channelId);
        recoveryStatusRef.current.set(d.channelId, 'recovering');
      }
      void requestSnapshot();
    };
    const handleIncomingRematch = (data: unknown) => setIncomingRematch(data as RematchOffer);
    const handleOutgoingRematch = (data: unknown) => setOutgoingRematch(data as RematchOffer);
    const handleRematchTerminal = (data: unknown) => {
      const { offerId } = data as { offerId?: number };
      setIncomingRematch(current => current?.offerId === offerId ? null : current);
      setOutgoingRematch(current => current?.offerId === offerId ? null : current);
    };
    const handleCommandError = (data: unknown) => {
      const error = data as { command?: string; path?: string; reservationId?: number; offerId?: number; sourceMatchId?: number; reason?: string };
      const correlated = error.command === 'game.ready' && error.path === 'games/ready' && typeof error.reservationId === 'number'
        ? { operation: 'ready' as const, id: error.reservationId }
        : error.command === 'game.respond' && error.path === 'games/respond' && typeof error.offerId === 'number'
          ? { operation: 'respondOffer' as const, id: error.offerId }
          : error.command === 'game.rematch' && error.path === 'games/rematch' && typeof error.sourceMatchId === 'number'
            ? { operation: 'requestRematch' as const, id: error.sourceMatchId }
            : null;
      if (correlated) setCommandError({ revision: ++commandErrorRevisionRef.current, ...correlated, reason: error.reason });
    };

    bridge.on('game.queueSnapshot', handleSnapshot);
    bridge.on('voice.connected', handleConnected);
    bridge.on('voice.channelChanged', handleChannelChanged);
    bridge.on('game.rematchOffered', handleIncomingRematch);
    bridge.on('game.rematchPending', handleOutgoingRematch);
    bridge.on('game.error', handleCommandError);
    for (const type of ['game.rematchAccepted', 'game.rematchDeclined', 'game.rematchExpired', 'game.rematchCanceled']) {
      bridge.on(type, handleRematchTerminal);
    }
    return () => {
      mountedRef.current = false;
      cancelRecovery();
      bridge.off('game.queueSnapshot', handleSnapshot);
      bridge.off('voice.connected', handleConnected);
      bridge.off('voice.channelChanged', handleChannelChanged);
      bridge.off('game.rematchOffered', handleIncomingRematch);
      bridge.off('game.rematchPending', handleOutgoingRematch);
      bridge.off('game.error', handleCommandError);
      for (const type of ['game.rematchAccepted', 'game.rematchDeclined', 'game.rematchExpired', 'game.rematchCanceled']) {
        bridge.off(type, handleRematchTerminal);
      }
    };
  }, [applySnapshot, cancelRecovery, requestSnapshot]);

  const reportDirectError = useCallback((operation: DuelCommandError['operation'], id: number) => {
    setCommandError({ revision: ++commandErrorRevisionRef.current, operation, id });
  }, []);
  const respondReady = useCallback((reservationId: number, ready: boolean) => {
    void gamesApi.respondReady(reservationId, ready).catch(() => reportDirectError('ready', reservationId));
  }, [reportDirectError]);
  const requestRematch = useCallback((sourceMatchId: number) => {
    void gamesApi.requestRematch(sourceMatchId).catch(() => reportDirectError('requestRematch', sourceMatchId));
  }, [reportDirectError]);
  const respondOffer = useCallback((offerId: number, accept: boolean) => {
    void gamesApi.respondOffer(offerId, accept).catch(() => reportDirectError('respondOffer', offerId));
  }, [reportDirectError]);
  const cancelOffer = useCallback((offerId: number) => {
    void gamesApi.cancelOffer(offerId).catch(() => {});
  }, []);
  const reset = useCallback(() => {
    cancelRecovery();
    acceptingSnapshotsRef.current = false;
    currentChannelIdRef.current = null;
    deniedChannelIdsRef.current.clear();
    recoveryBaselinesRef.current.clear();
    recoveryStatusRef.current.clear();
    setByChannel(new Map());
    setIncomingRematch(null);
    setOutgoingRematch(null);
    setCommandError(null);
  }, [cancelRecovery]);

  return {
    byChannel,
    incomingRematch,
    outgoingRematch,
    commandError,
    respondReady,
    requestRematch,
    respondOffer,
    cancelOffer,
    requestSnapshot,
    reset,
  };
}
