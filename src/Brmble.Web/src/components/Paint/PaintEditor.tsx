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
    void paintApi.commitStroke(sessionId, committedInput);
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

  return (
    <section className="paint-editor">
      <PaintToolbar tool={tool} color={color} width={width} onTool={setTool} onColor={setColor} onWidth={setWidth} />
      <div className="paint-canvas-stack">
        <canvas ref={sourceRef} data-testid="paint-source-canvas" />
        <canvas ref={annotationRef} data-testid="paint-annotation-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="paint-actions">
        <button onClick={() => void paintApi.undo(sessionId)}>Undo</button>
        {host && <>
          <button onClick={() => void paintApi.clear(sessionId)}>Clear</button>
          <button onClick={() => void paintApi.end(sessionId)}>End</button>
          <button onClick={() => void save()} disabled={saving || saved}>{saved ? 'Saved to chat' : saving ? 'Saving...' : 'Save to chat'}</button>
        </>}
      </div>
    </section>
  );
}
