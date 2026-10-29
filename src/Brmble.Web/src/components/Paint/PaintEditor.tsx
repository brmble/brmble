import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PaintPreview, PaintSessionSnapshot, PaintStrokeInput, PaintTool } from '../../types/paint';
import { applyPaintStrokeToContext, composePaintPng, initializePaintCanvases, loadPaintSourceImage, normalizeCanvasPoint } from '../../utils/paintCanvas';
import { DEFAULT_PAINT_COLOR } from '../../utils/paintPalette';
import { PaintToolbar } from './PaintToolbar';
import './PaintEditor.css';

type Api = {
  getSource(id: string): Promise<Blob>;
  getSnapshot(id: string): Promise<PaintSessionSnapshot>;
  commitStroke(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  sendPreview(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  undo(id: string): Promise<unknown> | void;
  clear(id: string): Promise<unknown> | void;
  end(id: string): Promise<unknown> | void;
};

export const PAINT_PREVIEW_THROTTLE_MS = 50;
export const PAINT_MAX_POINTS_PER_STROKE = 2000;

type SourceLoader = (sessionId: string) => Promise<Blob>;

export function PaintEditor({ sessionId, paintApi, snapshot, previews = [], currentUserId, loadSource = paintApi.getSource, onSave }: { sessionId: string; paintApi: Api; snapshot: PaintSessionSnapshot; previews?: PaintPreview[]; currentUserId: number; loadSource?: SourceLoader; onSave?: (png: Blob) => Promise<void> }) {
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
  const pendingCommitsRef = useRef<Set<Promise<boolean>>>(new Set());
  const savingRef = useRef(false);
  const cancelledLocalPreviewIdsRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(snapshot.generation);
  const drawingRef = useRef({ strokes: snapshot.strokes, previews });
  const [tool, setTool] = useState<PaintTool>('pen');
  const [color, setColor] = useState<string>(DEFAULT_PAINT_COLOR);
  const [width, setWidth] = useState(6);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const loadedSourceFingerprintRef = useRef<string | null>(null);
  const sourceLoadGenerationRef = useRef(0);
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

  const sourceFingerprint = snapshot.source
    ? `${sessionId}:${snapshot.source.mimeType}:${snapshot.source.width}:${snapshot.source.height}:${snapshot.source.sizeBytes}`
    : null;

  useEffect(() => {
    if (!sourceFingerprint || !sourceRef.current || !annotationRef.current) return;
    if (loadedSourceFingerprintRef.current === sourceFingerprint) return;
    const generation = ++sourceLoadGenerationRef.current;
    let cancelled = false;
    void loadSource(sessionId)
      .then(loadPaintSourceImage)
      .then(image => {
        if (cancelled || generation !== sourceLoadGenerationRef.current) return;
        loadedSourceFingerprintRef.current = sourceFingerprint;
        imageRef.current = image;
        initializePaintCanvases(sourceRef.current!, annotationRef.current!, image);
        redraw();
      })
      .catch(reason => {
        if (!cancelled && generation === sourceLoadGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Unable to load source image.');
      });
    return () => { cancelled = true; };
  }, [loadSource, sessionId, sourceFingerprint]);

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
    try {
      void Promise.resolve(paintApi.sendPreview(sessionId, buildInput())).then(
        () => setPreviewUnavailable(false),
        () => setPreviewUnavailable(true),
      );
    } catch {
      setPreviewUnavailable(true);
    }
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
    if (savingRef.current || activePointerId.current !== null) return;
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
    let request: Promise<unknown> | void;
    try {
      request = paintApi.commitStroke(sessionId, committedInput);
    } catch (reason) {
      request = Promise.reject(reason);
    }
    const commit = Promise.resolve(request).then(() => true, reason => {
      pendingLocalCommitIdsRef.current.delete(committedInput.correlationId);
      pendingLocalStrokesRef.current.delete(committedInput.correlationId);
      cancelledLocalPreviewIdsRef.current.add(committedInput.correlationId);
      redraw();
      setError(reason instanceof Error ? reason.message : 'Unable to commit stroke. Please try again.');
      return false;
    });
    pendingCommitsRef.current.add(commit);
    void commit.then(() => pendingCommitsRef.current.delete(commit));
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
    if (!onSave || !imageRef.current || savingRef.current || saved) return;
    if (activePointerId.current !== null) {
      setError('Finish your current stroke before saving.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      let png = savePngRef.current;
      if (!png) {
        const commits = await Promise.all([...pendingCommitsRef.current]);
        if (commits.some(success => !success)) throw new Error('A stroke could not be saved. Please try again.');
        const latest = await paintApi.getSnapshot(sessionId);
        if (latest.status !== 'active') throw new Error('This paint session is no longer active.');
        png = await composePaintPng(imageRef.current, imageRef.current.naturalWidth, imageRef.current.naturalHeight, latest.strokes);
      }
      savePngRef.current = png;
      await onSave(png);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save to chat. Please try again.');
    } finally {
      savingRef.current = false;
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
      <div className="paint-canvas-area">
        <div className="paint-canvas-stack" style={{ '--paint-aspect-ratio': snapshot.source ? snapshot.source.width / snapshot.source.height : 1 } as CSSProperties}>
          <canvas ref={sourceRef} data-testid="paint-source-canvas" />
          <canvas ref={annotationRef} data-testid="paint-annotation-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} />
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {previewUnavailable && <p role="status">Live preview unavailable. Your finished strokes can still be sent.</p>}
      <div className="paint-actions">
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => runMutation(() => paintApi.undo(sessionId), 'Unable to undo. Please try again.')}>Undo</button>
        {host && <>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => runMutation(() => paintApi.clear(sessionId), 'Unable to clear. Please try again.')}>Clear</button>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => runMutation(() => paintApi.end(sessionId), 'Unable to end paint. Please try again.')}>End</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || saved}>{saved ? 'Saved to chat' : saving ? 'Saving...' : 'Save to chat'}</button>
        </>}
      </div>
    </section>
  );
}
