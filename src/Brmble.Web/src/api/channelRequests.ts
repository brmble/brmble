import type {
  ChannelRequestApiError,
  ChannelRequestItem,
  ChannelRequestListResponse,
} from '../types/channelRequests';
import bridge from '../bridge';

export class ChannelRequestHttpError extends Error {
  code: string;
  status: number;

  constructor(error: ChannelRequestApiError, status: number) {
    super(error.message);
    this.name = 'ChannelRequestHttpError';
    this.code = error.code;
    this.status = status;
  }
}

async function safeParseError(response: Response): Promise<ChannelRequestApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { code: 'http_error', message: response.statusText || 'Request failed.' };
  }

  try {
    const payload = await response.json() as { error?: ChannelRequestApiError };
    return payload.error ?? { code: 'unknown_error', message: 'Request failed.' };
  } catch {
    return { code: 'unknown_error', message: 'Request failed.' };
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  throw new ChannelRequestHttpError(await safeParseError(response), response.status);
}

let nextBridgeRequestId = 1;

function isWebViewBridgeAvailable(): boolean {
  return !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
}

async function bridgeRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const requestId = nextBridgeRequestId++;

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      bridge.off('channelRequests.response', handleResponse);
    };

    const handleResponse = (data: unknown) => {
      const response = data as {
        requestId?: number;
        success?: boolean;
        body?: string;
        statusCode?: number;
        error?: string;
      };

      if (response.requestId !== requestId) return;

      cleanup();
      if (response.success && response.body) {
        resolve(JSON.parse(response.body) as T);
        return;
      }

      const parsedError = parseBridgeError(response);
      reject(new ChannelRequestHttpError(parsedError, response.statusCode ?? 0));
    };

    bridge.on('channelRequests.response', handleResponse);
    bridge.send('channelRequests.request', { ...payload, action, requestId });
  });
}

function parseBridgeError(response: { body?: string; error?: string; statusCode?: number }): ChannelRequestApiError {
  if (response.body) {
    try {
      const payload = JSON.parse(response.body) as { error?: ChannelRequestApiError };
      if (payload.error) {
        return payload.error;
      }
    } catch {
      // Fall through to the transport-level error below.
    }
  }

  return {
    code: 'http_error',
    message: response.error || (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.'),
  };
}

export async function createChannelRequest(input: { channelName: string; reason: string }) {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<ChannelRequestItem>('create', input);
  }

  const response = await fetch('/channel-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return unwrap<ChannelRequestItem>(response);
}

export async function listMyChannelRequests(): Promise<ChannelRequestItem[]> {
  if (isWebViewBridgeAvailable()) {
    const payload = await bridgeRequest<ChannelRequestListResponse>('listMine');
    return payload.items;
  }

  const response = await fetch('/channel-requests/mine');
  const payload = await unwrap<ChannelRequestListResponse>(response);
  return payload.items;
}

export async function listAdminChannelRequests(status = 'pending'): Promise<ChannelRequestItem[]> {
  if (isWebViewBridgeAvailable()) {
    const payload = await bridgeRequest<ChannelRequestListResponse>('listAdmin', { status });
    return payload.items;
  }

  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`/admin/channel-requests${query}`);
  const payload = await unwrap<ChannelRequestListResponse>(response);
  return payload.items;
}

export async function approveChannelRequest(id: number): Promise<ChannelRequestItem> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<ChannelRequestItem>('approve', { id });
  }

  const response = await fetch(`/admin/channel-requests/${id}/approve`, { method: 'POST' });
  return unwrap<ChannelRequestItem>(response);
}

export async function denyChannelRequest(id: number, reason: string): Promise<ChannelRequestItem> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<ChannelRequestItem>('deny', { id, reason });
  }

  const response = await fetch(`/admin/channel-requests/${id}/deny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  return unwrap<ChannelRequestItem>(response);
}
