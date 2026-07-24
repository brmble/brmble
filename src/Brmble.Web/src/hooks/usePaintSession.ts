import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../bridge';
import { paintApi } from '../api/paint';
import type { PaintParticipant, PaintPermanentEvent, PaintPreview, PaintSessionSnapshot, PaintStroke, PaintStrokeCommittedEvent, PaintStrokeUndoneEvent } from '../types/paint';

const EVENTS = ['paint.sourceAttached', 'paint.participantJoined', 'paint.participantLeft', 'paint.previewUpdated', 'paint.strokeCommitted', 'paint.strokeUndone', 'paint.canvasCleared', 'paint.sessionEnded', 'paint.sessionExpired', 'paint.sessionUnavailable', 'paint.roomCleanupFailed'] as const;

function previewKey(preview: Pick<PaintPreview, 'authorUserId' | 'correlationId'>): string {
  return `${preview.authorUserId}:${preview.correlationId}`;
}

function sortStrokes(strokes: PaintStroke[]): PaintStroke[] {
  return [...strokes].sort((left, right) => left.sequence - right.sequence);
}

export function usePaintSession(sessionId: string) {
  const [snapshot, setSnapshot] = useState<PaintSessionSnapshot | null>(null);
  const [previews, setPreviews] = useState<PaintPreview[]>([]);
  const snapshotRef = useRef<PaintSessionSnapshot | null>(null);

  const refresh = useCallback(async () => {
    const next = await paintApi.getSnapshot(sessionId);
    snapshotRef.current = next;
    setSnapshot(next);
    setPreviews([]);
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const isCurrentSession = (event: { sessionId?: string }) => event.sessionId === sessionId;
    const acceptPermanent = (event: PaintPermanentEvent, apply: (current: PaintSessionSnapshot) => PaintSessionSnapshot) => {
      if (!isCurrentSession(event)) return;
      const current = snapshotRef.current;
      if (!current || event.generation < current.generation) return;
      if (event.revision !== current.revision + 1) {
        if (event.revision > current.revision + 1) void refresh();
        return;
      }
      const next = apply(current);
      snapshotRef.current = next;
      setSnapshot(next);
    };
    const handlers: Record<string, (data: unknown) => void> = {
      'paint.previewUpdated': data => {
        const preview = data as PaintPreview;
        if (!isCurrentSession(preview)) return;
        const current = snapshotRef.current;
        if (!current || preview.generation < current.generation) return;
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
      'paint.sourceAttached': data => {
        const event = data as PaintPermanentEvent & { source: PaintSessionSnapshot['source'] };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, source: event.source }));
      },
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
        const event = data as PaintPermanentEvent & { status: PaintSessionSnapshot['status'] };
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation, status: event.status }));
      },
      'paint.roomCleanupFailed': data => {
        const event = data as PaintPermanentEvent;
        acceptPermanent(event, current => ({ ...current, revision: event.revision, generation: event.generation }));
      },
    };
    for (const event of EVENTS) bridge.on(event, handlers[event]);
    return () => { for (const event of EVENTS) bridge.off(event, handlers[event]); };
  }, [refresh, sessionId]);

  return { snapshot, strokes: snapshot?.strokes ?? [], previews, refresh };
}
