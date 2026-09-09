import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../bridge';
import { paintApi } from '../api/paint';
import type { PaintParticipant, PaintPermanentEvent, PaintPreview, PaintSessionSnapshot, PaintStroke, PaintStrokeCommittedEvent, PaintStrokeInput, PaintStrokeUndoneEvent } from '../types/paint';

const EVENTS = ['paint.participantJoined', 'paint.participantLeft', 'paint.previewUpdated', 'paint.strokeCommitted', 'paint.strokeUndone', 'paint.canvasCleared', 'paint.sessionEnded', 'paint.sessionExpired', 'paint.sessionUnavailable'] as const;

function previewKey(preview: Pick<PaintPreview, 'authorUserId' | 'correlationId'>): string {
  return `${preview.authorUserId}:${preview.correlationId}`;
}

function sortStrokes(strokes: PaintStroke[]): PaintStroke[] {
  return [...strokes].sort((left, right) => left.sequence - right.sequence);
}

function isOlderVersion(next: Pick<PaintSessionSnapshot, 'generation' | 'revision'>, current: Pick<PaintSessionSnapshot, 'generation' | 'revision'>): boolean {
  return next.generation < current.generation || (next.generation === current.generation && next.revision < current.revision);
}

function unavailableSnapshot(sessionId: string, event: PaintPermanentEvent): PaintSessionSnapshot {
  return {
    sessionId,
    channelId: 0,
    hostUserId: 0,
    status: 'unavailable',
    expiresAt: '',
    source: null,
    participants: [],
    strokes: [],
    generation: event.generation,
    revision: event.revision,
  };
}

export function usePaintSession(sessionId: string) {
  const [snapshot, setSnapshot] = useState<PaintSessionSnapshot | null>(null);
  const [previews, setPreviews] = useState<PaintPreview[]>([]);
  const [error, setError] = useState<{ sessionId: string; value: Error } | null>(null);
  const snapshotRef = useRef<PaintSessionSnapshot | null>(null);
  const unavailableSessionIdRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshSessionIdRef = useRef<string | null>(null);
  const refreshQueuedRef = useRef(false);
  const eventFloorRef = useRef<Pick<PaintPermanentEvent, 'generation' | 'revision'> | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refresh = useCallback((): Promise<void> => {
    if (sessionIdRef.current !== sessionId) return Promise.resolve();
    if (refreshPromiseRef.current && refreshSessionIdRef.current === sessionId) {
      refreshQueuedRef.current = true;
      return refreshPromiseRef.current;
    }
    const request = paintApi.getSnapshot(sessionId).then(next => {
      if (sessionIdRef.current !== sessionId) return;
      if (unavailableSessionIdRef.current === sessionId) return;
      const current = snapshotRef.current;
      const eventFloor = eventFloorRef.current;
      if (current && isOlderVersion(next, current)) return;
      if (!current && eventFloor && isOlderVersion(next, eventFloor)) {
        refreshQueuedRef.current = true;
        return;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setPreviews([]);
      setError(null);
    }).catch(reason => {
      if (sessionIdRef.current !== sessionId) return;
      const nextError = reason instanceof Error ? reason : new Error('Unable to load paint session.');
      if (!snapshotRef.current) setError({ sessionId, value: nextError });
      throw nextError;
    });
    refreshPromiseRef.current = request;
    refreshSessionIdRef.current = sessionId;
    const settle = () => {
      if (sessionIdRef.current !== sessionId || refreshPromiseRef.current !== request || refreshSessionIdRef.current !== sessionId) return;
      refreshPromiseRef.current = null;
      refreshSessionIdRef.current = null;
      if (!refreshQueuedRef.current) return;
      refreshQueuedRef.current = false;
      void refresh().catch(() => {});
    };
    void request.then(settle, settle);
    return request;
  }, [sessionId]);

  const refreshInBackground = useCallback(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    snapshotRef.current = null;
    unavailableSessionIdRef.current = null;
    refreshPromiseRef.current = null;
    refreshSessionIdRef.current = null;
    refreshQueuedRef.current = false;
    eventFloorRef.current = null;
    setSnapshot(null);
    setPreviews([]);
    setError(null);
  }, [sessionId]);

  useEffect(() => { refreshInBackground(); }, [refreshInBackground]);

  useEffect(() => {
    const isCurrentSession = (event: { sessionId?: string }) => event.sessionId === sessionId;
    const acceptPermanent = (event: PaintPermanentEvent, apply: (current: PaintSessionSnapshot) => PaintSessionSnapshot) => {
      if (!isCurrentSession(event)) return;
      const current = snapshotRef.current;
      if (!current) {
        const floor = eventFloorRef.current;
        if (!floor || !isOlderVersion(event, floor)) eventFloorRef.current = event;
        refreshInBackground();
        return;
      }
      if (!current || event.generation < current.generation) return;
      if (event.revision !== current.revision + 1) {
        if (event.revision > current.revision + 1) refreshInBackground();
        return;
      }
      const next = apply(current);
      snapshotRef.current = next;
      setSnapshot(next);
    };
    const handlers: Record<string, (data: unknown) => void> = {
      'paint.previewUpdated': data => {
        const event = data as Pick<PaintPreview, 'sessionId' | 'generation' | 'authorUserId' | 'authorMatrixUserId'> & { input: PaintStrokeInput };
        const preview: PaintPreview = { ...event.input, sessionId: event.sessionId, generation: event.generation, authorUserId: event.authorUserId, authorMatrixUserId: event.authorMatrixUserId };
        if (!isCurrentSession(preview)) return;
        const current = snapshotRef.current;
        if (!current || preview.generation < current.generation) return;
        if (current.strokes.some(stroke => previewKey(stroke) === previewKey(preview))) return;
        setPreviews(existing => [...existing.filter(item => previewKey(item) !== previewKey(preview)), preview]);
      },
      'paint.strokeCommitted': data => acceptPermanent(data as PaintStrokeCommittedEvent, current => {
        const event = data as PaintStrokeCommittedEvent;
        const strokes = sortStrokes([...current.strokes.filter(stroke => stroke.id !== event.stroke.id), event.stroke]);
        setPreviews(existing => existing.filter(preview => previewKey(preview) !== previewKey(event.stroke)));
        return { ...current, revision: event.revision, generation: event.generation, strokes };
      }),
      'paint.strokeUndone': data => acceptPermanent(data as PaintStrokeUndoneEvent, current => {
        const event = data as PaintStrokeUndoneEvent;
        return { ...current, revision: event.revision, generation: event.generation, strokes: current.strokes.filter(stroke => stroke.id !== event.undoneStrokeId) };
      }),
      'paint.canvasCleared': data => acceptPermanent(data as PaintPermanentEvent, current => {
        const event = data as PaintPermanentEvent;
        setPreviews([]);
        return { ...current, revision: event.revision, generation: event.generation, strokes: [] };
      }),
      'paint.participantJoined': data => {
        const event = data as PaintPermanentEvent & { participant: PaintParticipant };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, participants: [...current.participants.filter(item => item.userId !== event.participant.userId), event.participant] }));
      },
      'paint.participantLeft': data => {
        const event = data as PaintPermanentEvent & { participant: PaintParticipant };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, participants: current.participants.filter(item => item.userId !== event.participant.userId) }));
      },
      'paint.sessionEnded': data => {
        const event = data as PaintPermanentEvent & { status: PaintSessionSnapshot['status'] };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, status: event.status }));
      },
      'paint.sessionExpired': data => {
        const event = data as PaintPermanentEvent & { status: PaintSessionSnapshot['status'] };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, status: event.status }));
      },
      'paint.sessionUnavailable': data => {
        const event = data as PaintPermanentEvent;
        if (!isCurrentSession(event)) return;
        unavailableSessionIdRef.current = sessionId;
        const next = snapshotRef.current
          ? { ...snapshotRef.current, revision: event.revision, generation: event.generation, status: 'unavailable' as const }
          : unavailableSnapshot(sessionId, event);
        snapshotRef.current = next;
        setSnapshot(next);
        setPreviews([]);
      },
    };
    for (const event of EVENTS) bridge.on(event, handlers[event]);
    return () => { for (const event of EVENTS) bridge.off(event, handlers[event]); };
  }, [refreshInBackground, sessionId]);

  const currentSnapshot = snapshot?.sessionId === sessionId ? snapshot : null;
  const currentPreviews = currentSnapshot ? previews.filter(preview => preview.sessionId === sessionId) : [];
  const currentError = error?.sessionId === sessionId ? error.value : null;
  return { snapshot: currentSnapshot, strokes: currentSnapshot?.strokes ?? [], previews: currentPreviews, error: currentError, refresh };
}
