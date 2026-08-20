import type { PaintStroke, PaintStrokeInput } from '../types/paint';

export function normalizeCanvasPoint(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  };
}

export function applyPaintStrokeToContext(ctx: CanvasRenderingContext2D, width: number, height: number, stroke: PaintStrokeInput | PaintStroke): void {
  const first = stroke.points[0];
  if (!first) return;
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color ?? '#000000';
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const x = first.x * width;
  const y = first.y * height;
  if (stroke.points.length === 1) {
    ctx.fillStyle = stroke.color ?? '#000000';
    ctx.arc(x, y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(x, y);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
  ctx.stroke();
}

export function drawPaintStroke(canvas: HTMLCanvasElement, stroke: PaintStroke): void {
  const ctx = canvas.getContext('2d');
  if (ctx) applyPaintStrokeToContext(ctx, canvas.width, canvas.height, stroke);
}

export async function loadPaintSourceImage(source: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function initializePaintCanvases(sourceCanvas: HTMLCanvasElement, annotationCanvas: HTMLCanvasElement, image: HTMLImageElement): void {
  sourceCanvas.width = annotationCanvas.width = image.naturalWidth;
  sourceCanvas.height = annotationCanvas.height = image.naturalHeight;
  sourceCanvas.getContext('2d')?.drawImage(image, 0, 0);
}

export async function composePaintPng(sourceImage: CanvasImageSource, width: number, height: number, strokes: PaintStroke[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  const annotations = document.createElement('canvas');
  annotations.width = width;
  annotations.height = height;
  const annotationContext = annotations.getContext('2d');
  if (!annotationContext) throw new Error('Canvas is unavailable.');
  ctx.drawImage(sourceImage, 0, 0, width, height);
  for (const stroke of strokes) applyPaintStrokeToContext(annotationContext, width, height, stroke);
  ctx.drawImage(annotations, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode PNG.')), 'image/png'));
}
