import bridge from '../bridge';

const REQUEST_TIMEOUT_MS = 15_000;
let nextRequestId = 1;

export type MessageDeletionErrorCode =
  | 'invalid_request'
  | 'not_authorized'
  | 'expired'
  | 'already_deleted'
  | 'invalid_event'
  | 'matrix_unavailable'
  | 'request_failed';

const MESSAGE_DELETION_ERROR_CODES = new Set<MessageDeletionErrorCode>([
  'invalid_request', 'not_authorized', 'expired', 'already_deleted',
  'invalid_event', 'matrix_unavailable', 'request_failed',
]);

function isMessageDeletionErrorCode(value: unknown): value is MessageDeletionErrorCode {
  return typeof value === 'string' && MESSAGE_DELETION_ERROR_CODES.has(value as MessageDeletionErrorCode);
}

export class MessageDeletionError extends Error {
  readonly code: MessageDeletionErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    code: MessageDeletionErrorCode,
    statusCode: number,
  ) {
    super(message);
    this.name = 'MessageDeletionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface BridgeResponse {
  requestId?: number;
  success?: boolean;
  body?: string;
  statusCode?: number;
  error?: string;
}

function parseError(body: string | undefined, fallback: string | undefined, statusCode: number): MessageDeletionError {
  let parsed: { code?: string; error?: string } = {};
  if (body) {
    try { parsed = JSON.parse(body) as typeof parsed; } catch { parsed = {}; }
  }
  return new MessageDeletionError(
    parsed.error ?? fallback ?? 'Message could not be deleted. Try again.',
    isMessageDeletionErrorCode(parsed.code) ? parsed.code : 'request_failed',
    statusCode,
  );
}

function isWebViewBridgeAvailable(): boolean {
  return !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
}

function deleteThroughBridge(roomId: string, eventId: string): Promise<void> {
  const requestId = nextRequestId++;
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      bridge.off('messages.response', handleResponse);
      if (timer !== undefined) clearTimeout(timer);
    };
    const handleResponse = (data: unknown) => {
      const response = data as BridgeResponse;
      if (response.requestId !== requestId) return;
      cleanup();
      if (response.success) {
        resolve();
      } else {
        reject(parseError(response.body, response.error, response.statusCode ?? 0));
      }
    };
    bridge.on('messages.response', handleResponse);
    timer = setTimeout(() => {
      cleanup();
      reject(new MessageDeletionError('Message deletion timed out. Try again.', 'request_failed', 0));
    }, REQUEST_TIMEOUT_MS);
    try {
      bridge.send('messages.delete', { requestId, roomId, eventId });
    } catch (error) {
      cleanup();
      reject(new MessageDeletionError(
        error instanceof Error ? error.message : 'Message could not be deleted. Try again.',
        'request_failed',
        0,
      ));
    }
  });
}

async function deleteThroughFetch(roomId: string, eventId: string): Promise<void> {
  try {
    const response = await fetch('/messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, eventId }),
    });
    if (response.ok) return;
    throw parseError(await response.text(), response.statusText, response.status);
  } catch (error) {
    if (error instanceof MessageDeletionError) throw error;
    throw new MessageDeletionError(
      error instanceof Error ? error.message : 'Message could not be deleted. Try again.',
      'request_failed',
      0,
    );
  }
}

export const messageApi = {
  delete(roomId: string, eventId: string): Promise<void> {
    return isWebViewBridgeAvailable() ? deleteThroughBridge(roomId, eventId) : deleteThroughFetch(roomId, eventId);
  },
};
