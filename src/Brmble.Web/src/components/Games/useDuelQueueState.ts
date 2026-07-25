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
  respondReady: (reservationId: number, ready: boolean) => void;
  requestRematch: (sourceMatchId: number) => void;
  respondOffer: (offerId: number, accept: boolean) => void;
  cancelOffer: (offerId: number) => void;
  requestSnapshot: () => Promise<void>;
  reset: () => void;
}

export function useDuelQueueState(): DuelQueueState {
  const [byChannel, setByChannel] = useState<Map<number, DuelQueueSnapshot>>(() => new Map());
  const [incomingRematch, setIncomingRematch] = useState<RematchOffer | null>(null);
  const [outgoingRematch, setOutgoingRematch] = useState<RematchOffer | null>(null);
  const deniedChannelIdsRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  const requestEpochRef = useRef(0);
  const currentChannelIdRef = useRef<number | null>(null);

  const applySnapshot = useCallback((snapshot: DuelQueueSnapshot) => {
    if (snapshot.schemaVersion !== 1 || deniedChannelIdsRef.current.has(snapshot.channelId)) return;
    setByChannel(previous => {
      const current = previous.get(snapshot.channelId);
      if (current && (snapshot.generation < current.generation
        || (snapshot.generation === current.generation && snapshot.revision <= current.revision))) {
        return previous;
      }
      const next = new Map(previous);
      next.set(snapshot.channelId, snapshot);
      return next;
    });
  }, []);

  const requestSnapshot = useCallback(async () => {
    const epoch = ++requestEpochRef.current;
    const requestedChannelId = currentChannelIdRef.current;
    try {
      const snapshot = await gamesApi.getQueueSnapshot();
      if (!mountedRef.current || requestEpochRef.current !== epoch) return;
      if (requestedChannelId != null && snapshot.channelId !== requestedChannelId) return;
      if (currentChannelIdRef.current != null && snapshot.channelId !== currentChannelIdRef.current) return;
      applySnapshot(snapshot);
    } catch {
      // Queue snapshots are advisory and a later push or channel change retries them.
    }
  }, [applySnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    const handleSnapshot = (data: unknown) => applySnapshot(data as DuelQueueSnapshot);
    const handleChannelChanged = (data: unknown) => {
      const d = data as { channelId?: number; previousChannelId?: number };
      requestEpochRef.current++;
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

    bridge.on('game.queueSnapshot', handleSnapshot);
    bridge.on('voice.channelChanged', handleChannelChanged);
    bridge.on('game.rematchOffered', handleIncomingRematch);
    bridge.on('game.rematchPending', handleOutgoingRematch);
    for (const type of ['game.rematchAccepted', 'game.rematchDeclined', 'game.rematchExpired', 'game.rematchCanceled']) {
      bridge.on(type, handleRematchTerminal);
    }
    return () => {
      mountedRef.current = false;
      requestEpochRef.current++;
      bridge.off('game.queueSnapshot', handleSnapshot);
      bridge.off('voice.channelChanged', handleChannelChanged);
      bridge.off('game.rematchOffered', handleIncomingRematch);
      bridge.off('game.rematchPending', handleOutgoingRematch);
      for (const type of ['game.rematchAccepted', 'game.rematchDeclined', 'game.rematchExpired', 'game.rematchCanceled']) {
        bridge.off(type, handleRematchTerminal);
      }
    };
  }, [applySnapshot, requestSnapshot]);

  const contain = useCallback((request: Promise<void>) => { void request.catch(() => {}); }, []);
  const respondReady = useCallback((reservationId: number, ready: boolean) => {
    contain(gamesApi.respondReady(reservationId, ready));
  }, [contain]);
  const requestRematch = useCallback((sourceMatchId: number) => {
    contain(gamesApi.requestRematch(sourceMatchId));
  }, [contain]);
  const respondOffer = useCallback((offerId: number, accept: boolean) => {
    contain(gamesApi.respondOffer(offerId, accept));
  }, [contain]);
  const cancelOffer = useCallback((offerId: number) => {
    contain(gamesApi.cancelOffer(offerId));
  }, [contain]);
  const reset = useCallback(() => {
    requestEpochRef.current++;
    currentChannelIdRef.current = null;
    deniedChannelIdsRef.current.clear();
    setByChannel(new Map());
    setIncomingRematch(null);
    setOutgoingRematch(null);
  }, []);

  return {
    byChannel,
    incomingRematch,
    outgoingRematch,
    respondReady,
    requestRematch,
    respondOffer,
    cancelOffer,
    requestSnapshot,
    reset,
  };
}
