import bridge from '../bridge';
import type { PaintSessionSnapshot, PaintStrokeInput } from '../types/paint';

const BRIDGE_REQUEST_TIMEOUT_MS = 15_000;
let nextRequestId = 1;

interface BridgeResponse {
  requestId?: number;
  success?: boolean;
  body?: string;
  statusCode?: number;
  error?: string;
}

function isWebViewBridgeAvailable(): boolean {
  return !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
}

function bridgeRequest<T>(payload: Record<string, unknown>): Promise<T> {
  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      bridge.off('paint.response', handleResponse);
      if (timer !== undefined) clearTimeout(timer);
    };
    const handleResponse = (data: unknown) => {
      const response = data as BridgeResponse;
      if (response.requestId !== requestId) return;
      cleanup();
      if (response.success && response.body) {
        try {
          resolve(JSON.parse(response.body) as T);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Failed to parse response.'));
        }
        return;
      }
      reject(new Error(response.error || (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.')));
    };
    bridge.on('paint.response', handleResponse);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Request timed out.'));
    }, BRIDGE_REQUEST_TIMEOUT_MS);
    bridge.send('paint.request', { ...payload, requestId });
  });
}

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (isWebViewBridgeAvailable()) return bridgeRequest<T>({ action, ...payload });
  const response = await fetch(`/paint/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(response.statusText || 'Request failed.');
  return response.json() as Promise<T>;
}

function mutate(event: string, payload: Record<string, unknown>): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send(event, payload);
    return Promise.resolve();
  }
  return request<void>(event.replace('paint.', ''), payload);
}

function normalizedStroke(stroke: PaintStrokeInput): PaintStrokeInput {
  return {
    correlationId: stroke.correlationId,
    generation: stroke.generation,
    tool: stroke.tool,
    ...(stroke.color ? { color: stroke.color } : {}),
    width: stroke.width,
    points: stroke.points.map(point => ({ x: point.x, y: point.y, ...(point.pressure === undefined ? {} : { pressure: point.pressure }) })),
  };
}

export const paintApi = {
  createSession: (input: { channelId: number; participantUserIds: number[] }) => mutate('paint.create', input),
  attachSource: (sessionId: string, sourceEventId: string) => mutate('paint.attachSource', { sessionId, sourceEventId }),
  join: (sessionId: string) => mutate('paint.join', { sessionId }),
  leave: (sessionId: string) => mutate('paint.leave', { sessionId }),
  commitStroke: (sessionId: string, stroke: PaintStrokeInput) => mutate('paint.commitStroke', { sessionId, ...normalizedStroke(stroke) }),
  sendPreview: (sessionId: string, stroke: PaintStrokeInput) => mutate('paint.sendPreview', { sessionId, ...normalizedStroke(stroke) }),
  undo: (sessionId: string) => mutate('paint.undo', { sessionId }),
  clear: (sessionId: string) => mutate('paint.clear', { sessionId }),
  end: (sessionId: string) => mutate('paint.end', { sessionId }),
  getSnapshot: (sessionId: string) => request<PaintSessionSnapshot>('snapshot', { sessionId }),
};
