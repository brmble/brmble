export interface DeleteMessageRequest {
  roomId: string;
  eventId: string;
  txnId?: string;
}

export interface DeleteMessageResponse {
  roomId: string;
  eventId: string;
  redactionEventId: string;
  reason: string;
  placeholderText: string;
  actorType: string;
}

export class DeleteMessageError extends Error {
  status: number;
  errorCode: string;
  detail?: string;

  constructor(status: number, errorCode: string, detail?: string) {
    super(detail || errorCode);
    this.status = status;
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

export function resolveDeleteMessageApiBaseUrl(options: {
  homeserverUrl?: string | null;
  fallbackOrigin: string;
}): string {
  const baseUrl = options.homeserverUrl?.trim();
  if (!baseUrl) return options.fallbackOrigin;
  return baseUrl.replace(/\/+$/, '');
}

export async function deleteMessage(
  apiBaseUrl: string,
  matrixAccessToken: string,
  request: DeleteMessageRequest,
): Promise<DeleteMessageResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/messages/redact`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${matrixAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Network request failed';
    throw new DeleteMessageError(0, 'network_error', detail);
  }

  const responseText = await response.text();
  const body = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    const errorCode = typeof body.errorCode === 'string' ? body.errorCode : 'delete_failed';
    const detail = typeof body.detail === 'string'
      ? body.detail
      : typeof body.title === 'string'
        ? body.title
        : response.statusText || undefined;
    throw new DeleteMessageError(response.status, errorCode, detail);
  }

  return body as DeleteMessageResponse;
}

export async function deleteMessageViaBridge(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
  const webview = (window as Window & {
    chrome?: { webview?: { postMessage: (message: unknown) => void } };
  }).chrome?.webview;
  if (!webview) {
    throw new DeleteMessageError(0, 'bridge_unavailable', 'Desktop bridge is not available.');
  }

  const bridgeModule = await import('../bridge');
  const bridge = bridgeModule.default;
  const requestId = crypto.randomUUID();

  return await new Promise<DeleteMessageResponse>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      bridge.off('chat.deleteMessageSuccess', handleSuccess);
      bridge.off('chat.deleteMessageError', handleError);
    };

    const handleSuccess = (data: unknown) => {
      const payload = data as (DeleteMessageResponse & { requestId?: string }) | undefined;
      if (payload?.requestId !== requestId) return;
      cleanup();
      resolve({
        roomId: payload.roomId,
        eventId: payload.eventId,
        redactionEventId: payload.redactionEventId,
        reason: payload.reason,
        placeholderText: payload.placeholderText,
        actorType: payload.actorType,
      });
    };

    const handleError = (data: unknown) => {
      const payload = data as { requestId?: string; status?: number; errorCode?: string; detail?: string } | undefined;
      if (payload?.requestId !== requestId) return;
      cleanup();
      reject(new DeleteMessageError(payload.status ?? 0, payload.errorCode ?? 'delete_failed', payload.detail));
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new DeleteMessageError(0, 'delete_timeout', 'Timed out waiting for desktop delete response.'));
    }, 15000);

    bridge.on('chat.deleteMessageSuccess', handleSuccess);
    bridge.on('chat.deleteMessageError', handleError);
    bridge.send('chat.deleteMessage', { ...request, requestId });
  });
}
