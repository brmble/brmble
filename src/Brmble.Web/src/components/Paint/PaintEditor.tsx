import { useEffect, useRef, useState } from 'react';
import type { PaintPreview, PaintSessionSnapshot, PaintStrokeInput, PaintTool } from '../../types/paint';
import { applyPaintStrokeToContext, composePaintPng, initializePaintCanvases, loadPaintSourceImage, normalizeCanvasPoint, type MatrixMediaClient } from '../../utils/paintCanvas';
import { DEFAULT_PAINT_COLOR } from '../../utils/paintPalette';
import { PaintToolbar } from './PaintToolbar';
import './PaintEditor.css';

type Api = {
  commitStroke(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  sendPreview(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  undo(id: string): Promise<unknown> | void;
  clear(id: string): Promise<unknown> | void;
  end(id: string): Promise<unknown> | void;
};

export const PAINT_PREVIEW_THROTTLE_MS = 50;
export const PAINT_MAX_POINTS_PER_STROKE = 2000;

export function PaintEditor({ sessionId, paintApi, snapshot, previews = [], currentUserId, matrixClient, onSave }: { sessionId: string; paintApi: Api; snapshot: PaintSessionSnapshot; previews?: PaintPreview[]; currentUserId: number; matrixClient?: MatrixMediaClient; onSave?: (png: Blob) => Promise<void> }) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const savePngRef = useRef<Blob | null>(null);
  const points = useRef<PaintStrokeInput['points']>([]);
  const correlationId = useRef<string | null>(null);
  const activePointerId = useRef<number | null>(null);
  const localStrokeRef = useRef<PaintStrokeInput | null>(null);
  const lastPreviewAtRef = useRef<number | null>(null);
  const pendingLocalCommitIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalStrokesRef = useRef<Map<string, PaintStrokeInput>>(new Map());
  const cancelledLocalPreviewIdsRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(snapshot.generation);
  const drawingRef = useRef({ strokes: snapshot.strokes, previews });
  const [tool, setTool] = useState<PaintTool>('pen');
  const [color, setColor] = useState<string>(DEFAULT_PAINT_COLOR);
  const [width, setWidth] = useState(6);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = snapshot.isHost ?? snapshot.hostUserId === currentUserId;

  drawingRef.current = { strokes: snapshot.strokes, previews };

  const redraw = () => {
    const canvas = annotationRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of drawingRef.current.strokes) {
      applyPaintStrokeToContext(ctx, canvas.width, canvas.height, stroke);
    }
    for (const preview of drawingRef.current.previews) {
      if (preview.authorUserId === currentUserId && preview.correlationId === correlationId.current) continue;
      if (preview.authorUserId === currentUserId && pendingLocalCommitIdsRef.current.has(preview.correlationId)) continue;
      if (preview.authorUserId === currentUserId && cancelledLocalPreviewIdsRef.current.has(preview.correlationId)) continue;
      applyPaintStrokeToContext(ctx, canvas.width, canvas.height, preview);
    }
    for (const stroke of pendingLocalStrokesRef.current.values()) {
      applyPaintStrokeToContext(ctx, canvas.width, canvas.height, stroke);
    }
    if (localStrokeRef.current) {
      applyPaintStrokeToContext(ctx, canvas.width, canvas.height, localStrokeRef.current);
    }
  };

  useEffect(() => {
    if (!snapshot.source || !matrixClient || !sourceRef.current || !annotationRef.current) return;
    void loadPaintSourceImage(matrixClient, snapshot.source)
      .then(image => {
        imageRef.current = image;
        initializePaintCanvases(sourceRef.current!, annotationRef.current!, image);
        redraw();
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load source image.'));
  }, [matrixClient, snapshot.source]);

  useEffect(() => {
    for (const stroke of snapshot.strokes) {
      if (stroke.authorUserId === currentUserId) {
        pendingLocalCommitIdsRef.current.delete(stroke.correlationId);
        pendingLocalStrokesRef.current.delete(stroke.correlationId);
      }
    }
  }, [currentUserId, snapshot.strokes]);

  useEffect(() => {
    if (generationRef.current === snapshot.generation) return;
    generationRef.current = snapshot.generation;
    pendingLocalCommitIdsRef.current.clear();
    pendingLocalStrokesRef.current.clear();
    cancelledLocalPreviewIdsRef.current.clear();
    points.current = [];
    correlationId.current = null;
    activePointerId.current = null;
    localStrokeRef.current = null;
    lastPreviewAtRef.current = null;
    redraw();
  }, [snapshot.generation]);

  useEffect(() => {
    redraw();
  }, [snapshot.strokes, previews]);

  const buildInput = (): PaintStrokeInput => ({
    correlationId: correlationId.current!,
    generation: snapshot.generation,
    tool,
    ...(tool === 'pen' ? { color } : {}),
    width,
    points: points.current,
  });

  const appendPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (points.current.length >= PAINT_MAX_POINTS_PER_STROKE) return;
    const point = normalizeCanvasPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const last = points.current.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) {
      points.current = [...points.current, point];
    }
  };

  const sendPreviewIfDue = () => {
    const currentTime = performance.now();
    if (lastPreviewAtRef.current !== null && currentTime - lastPreviewAtRef.current < PAINT_PREVIEW_THROTTLE_MS) return;
    lastPreviewAtRef.current = currentTime;
    void paintApi.sendPreview(sessionId, buildInput());
  };

  const resetGesture = (pointerId: number) => {
    if (activePointerId.current !== pointerId) return;
    points.current = [];
    correlationId.current = null;
    activePointerId.current = null;
    localStrokeRef.current = null;
    lastPreviewAtRef.current = null;
  };

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== null) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointerId.current = event.pointerId;
    correlationId.current = crypto.randomUUID();
    points.current = [normalizeCanvasPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())];
    localStrokeRef.current = buildInput();
    lastPreviewAtRef.current = null;
    redraw();
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== event.pointerId || !points.current.length) return;
    appendPoint(event);
    localStrokeRef.current = buildInput();
    redraw();
    sendPreviewIfDue();
  };

  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== event.pointerId || !points.current.length) return;
    appendPoint(event);
    localStrokeRef.current = buildInput();
    redraw();
    const committedInput = buildInput();
    pendingLocalCommitIdsRef.current.add(committedInput.correlationId);
    pendingLocalStrokesRef.current.set(committedInput.correlationId, committedInput);
    void Promise.resolve(paintApi.commitStroke(sessionId, committedInput)).catch(reason => {
      pendingLocalCommitIdsRef.current.delete(committedInput.correlationId);
      pendingLocalStrokesRef.current.delete(committedInput.correlationId);
      cancelledLocalPreviewIdsRef.current.add(committedInput.correlationId);
      redraw();
      setError(reason instanceof Error ? reason.message : 'Unable to commit stroke. Please try again.');
    });
    resetGesture(event.pointerId);
  };

  const cancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    if (correlationId.current) {
      cancelledLocalPreviewIdsRef.current.add(correlationId.current);
    }
    resetGesture(event.pointerId);
    redraw();
  };

  const save = async () => {
    if (!onSave || !imageRef.current || saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      const png = savePngRef.current ?? await composePaintPng(imageRef.current, imageRef.current.naturalWidth, imageRef.current.naturalHeight, snapshot.strokes);
      savePngRef.current = png;
      await onSave(png);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save to chat. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const runMutation = (operation: () => Promise<unknown> | void, fallback: string) => {
    setError(null);
    void Promise.resolve(operation()).catch(reason => setError(reason instanceof Error ? reason.message : fallback));
  };

  return (
    <section className="paint-editor">
      <PaintToolbar tool={tool} color={color} width={width} onTool={setTool} onColor={setColor} onWidth={setWidth} />
      <div className="paint-canvas-stack">
        <canvas ref={sourceRef} data-testid="paint-source-canvas" />
        <canvas ref={annotationRef} data-testid="paint-annotation-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="paint-actions">
        <button type="button" className="btn btn-secondary" onClick={() => runMutation(() => paintApi.undo(sessionId), 'Unable to undo. Please try again.')}>Undo</button>
        {host && <>
          <button type="button" className="btn btn-danger" onClick={() => runMutation(() => paintApi.clear(sessionId), 'Unable to clear. Please try again.')}>Clear</button>
          <button type="button" className="btn btn-danger" onClick={() => runMutation(() => paintApi.end(sessionId), 'Unable to end paint. Please try again.')}>End</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || saved}>{saved ? 'Saved to chat' : saving ? 'Saving...' : 'Save to chat'}</button>
        </>}
      </div>
    </section>
  );
}
