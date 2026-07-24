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

async function post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(response.statusText || 'Request failed.');
  return response.json() as Promise<T>;
}

async function mutate(event: string, path: string, payload: Record<string, unknown>): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send(event, payload);
    return;
  }
  await post<unknown>(path, payload);
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
  createSession: (input: { channelId: number; participantUserIds: number[] }) => mutate('paint.create', '/paint/sessions', input),
  attachSource: (sessionId: string, sourceEventId: string) => mutate('paint.attachSource', `/paint/sessions/${encodeURIComponent(sessionId)}/source`, { sessionId, sourceEventId }),
  join: (sessionId: string) => mutate('paint.join', `/paint/sessions/${encodeURIComponent(sessionId)}/join`, { sessionId }),
  leave: (sessionId: string) => mutate('paint.leave', `/paint/sessions/${encodeURIComponent(sessionId)}/leave`, { sessionId }),
  commitStroke: (sessionId: string, stroke: PaintStrokeInput) => mutate('paint.commitStroke', `/paint/sessions/${encodeURIComponent(sessionId)}/stroke`, { sessionId, ...normalizedStroke(stroke) }),
  sendPreview: (sessionId: string, stroke: PaintStrokeInput) => mutate('paint.sendPreview', `/paint/sessions/${encodeURIComponent(sessionId)}/preview`, { sessionId, ...normalizedStroke(stroke) }),
  undo: (sessionId: string) => mutate('paint.undo', `/paint/sessions/${encodeURIComponent(sessionId)}/undo`, { sessionId }),
  clear: (sessionId: string) => mutate('paint.clear', `/paint/sessions/${encodeURIComponent(sessionId)}/clear`, { sessionId }),
  end: (sessionId: string) => mutate('paint.end', `/paint/sessions/${encodeURIComponent(sessionId)}/end`, { sessionId }),
  async getSnapshot(sessionId: string): Promise<PaintSessionSnapshot> {
    if (isWebViewBridgeAvailable()) return bridgeRequest<PaintSessionSnapshot>({ action: 'snapshot', sessionId });
    const response = await fetch(`/paint/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
    if (!response.ok) throw new Error(response.statusText || 'Request failed.');
    return response.json() as Promise<PaintSessionSnapshot>;
  },
};
