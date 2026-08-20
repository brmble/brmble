import { useEffect, useRef, useState } from 'react';
import type { PaintPreview, PaintSessionSnapshot, PaintStrokeInput, PaintTool } from '../../types/paint';
import { applyPaintStrokeToContext, composePaintPng, initializePaintCanvases, loadPaintSourceImage, normalizeCanvasPoint } from '../../utils/paintCanvas';
import { DEFAULT_PAINT_COLOR } from '../../utils/paintPalette';
import { Icon } from '../Icon/Icon';
import { PaintToolbar } from './PaintToolbar';
import './PaintEditor.css';

type Api = {
  getSource(id: string): Promise<Blob>;
  commitStroke(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  sendPreview(id: string, stroke: PaintStrokeInput): Promise<unknown> | void;
  undo(id: string): Promise<unknown> | void;
  clear(id: string): Promise<unknown> | void;
  end(id: string): Promise<unknown> | void;
};

export const PAINT_PREVIEW_THROTTLE_MS = 50;
export const PAINT_MAX_POINTS_PER_STROKE = 2000;
export const PAINT_MIN_ZOOM = 0.25;
export const PAINT_MAX_ZOOM = 4;
export const PAINT_ZOOM_STEP = 0.25;

function calculateFitZoom(imageWidth: number, imageHeight: number, viewport: HTMLElement | null): number {
  if (!viewport || imageWidth <= 0 || imageHeight <= 0 || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return 1;
  return Math.min(1, viewport.clientWidth / imageWidth, viewport.clientHeight / imageHeight);
}

type SourceLoader = (sessionId: string) => Promise<Blob>;

export function PaintEditor({ sessionId, paintApi, snapshot, previews = [], currentUserId, loadSource = paintApi.getSource, onSave }: { sessionId: string; paintApi: Api; snapshot: PaintSessionSnapshot; previews?: PaintPreview[]; currentUserId: number; loadSource?: SourceLoader; onSave?: (png: Blob) => Promise<void> }) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
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
  const loadedSourceFingerprintRef = useRef<string | null>(null);
  const sourceLoadGenerationRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const fitZoomRef = useRef(1);
  const zoomRef = useRef(1);
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
        const nextFitZoom = calculateFitZoom(image.naturalWidth, image.naturalHeight, viewportRef.current);
        fitZoomRef.current = nextFitZoom;
        zoomRef.current = nextFitZoom;
        setZoom(nextFitZoom);
        redraw();
      })
      .catch(reason => {
        if (!cancelled && generation === sourceLoadGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Unable to load source image.');
      });
    return () => { cancelled = true; };
  }, [loadSource, sessionId, sourceFingerprint]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateFitZoom = () => {
      const image = imageRef.current;
      if (!image) return;
      const nextFitZoom = calculateFitZoom(image.naturalWidth, image.naturalHeight, viewport);
      const wasFitted = Math.abs(zoomRef.current - fitZoomRef.current) < 0.001;
      fitZoomRef.current = nextFitZoom;
      if (wasFitted) {
        zoomRef.current = nextFitZoom;
        setZoom(nextFitZoom);
      }
    };
    updateFitZoom();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [snapshot.source]);

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
    ...(tool !== 'eraser' ? { color } : {}),
    width,
    points: points.current,
  });

  const appendPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (points.current.length >= PAINT_MAX_POINTS_PER_STROKE) return;
    const point = normalizeCanvasPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const last = points.current.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) {
      points.current = tool === 'line'
        ? [points.current[0], point]
        : [...points.current, point];
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

  const updateZoom = (nextZoom: number, focus?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    const canvas = annotationRef.current;
    const currentZoom = zoomRef.current;
    const clampedZoom = Math.min(PAINT_MAX_ZOOM, Math.max(PAINT_MIN_ZOOM, nextZoom));
    if (clampedZoom === currentZoom) return;
    if (viewport && focus) {
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      const localX = focus.x - viewportRect.left;
      const localY = focus.y - viewportRect.top;
      const imageX = canvasRect ? (focus.x - canvasRect.left) / currentZoom : (viewport.scrollLeft + localX) / currentZoom;
      const imageY = canvasRect ? (focus.y - canvasRect.top) / currentZoom : (viewport.scrollTop + localY) / currentZoom;
      requestAnimationFrame(() => {
        const nextCanvasRect = canvas?.getBoundingClientRect();
        const nextViewportRect = viewport.getBoundingClientRect();
        const canvasOriginX = nextCanvasRect ? nextCanvasRect.left - nextViewportRect.left + viewport.scrollLeft : viewport.scrollLeft;
        const canvasOriginY = nextCanvasRect ? nextCanvasRect.top - nextViewportRect.top + viewport.scrollTop : viewport.scrollTop;
        const nextLocalX = focus.x - nextViewportRect.left;
        const nextLocalY = focus.y - nextViewportRect.top;
        viewport.scrollLeft = Math.max(0, canvasOriginX + imageX * clampedZoom - nextLocalX);
        viewport.scrollTop = Math.max(0, canvasOriginY + imageY * clampedZoom - nextLocalY);
      });
    }
    zoomRef.current = clampedZoom;
    setZoom(clampedZoom);
  };

  const fitImage = () => {
    zoomRef.current = fitZoomRef.current;
    setZoom(fitZoomRef.current);
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return;
    event.preventDefault();
    updateZoom(zoomRef.current + (event.deltaY < 0 ? PAINT_ZOOM_STEP : -PAINT_ZOOM_STEP), { x: event.clientX, y: event.clientY });
  };

  const imageWidth = imageRef.current?.naturalWidth ?? snapshot.source?.width ?? 0;
  const imageHeight = imageRef.current?.naturalHeight ?? snapshot.source?.height ?? 0;
  const canvasSize = imageWidth > 0 && imageHeight > 0
    ? { width: imageWidth * zoom, height: imageHeight * zoom }
    : undefined;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <section className="paint-editor">
      <PaintToolbar tool={tool} color={color} width={width} onTool={setTool} onColor={setColor} onWidth={setWidth} />
      <div className="paint-zoom-controls" aria-label="Paint zoom controls">
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Zoom out" onClick={() => updateZoom(zoom - PAINT_ZOOM_STEP)} disabled={zoom <= PAINT_MIN_ZOOM}><Icon name="minus" size={18} /></button>
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Fit image" onClick={fitImage}>Fit</button>
        <span role="status" aria-live="polite">{zoomPercent}%</span>
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Zoom in" onClick={() => updateZoom(zoom + PAINT_ZOOM_STEP)} disabled={zoom >= PAINT_MAX_ZOOM}><Icon name="plus" size={18} /></button>
      </div>
      <div ref={viewportRef} className="paint-viewport" data-testid="paint-viewport" onWheel={handleWheel}>
        <div className="paint-canvas-stack" style={canvasSize}>
          <canvas ref={sourceRef} data-testid="paint-source-canvas" style={canvasSize} />
          <canvas ref={annotationRef} data-testid="paint-annotation-canvas" style={canvasSize} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} />
        </div>
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
