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

  constructor(status: number, errorCode: string) {
    super(errorCode);
    this.status = status;
    this.errorCode = errorCode;
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
  const response = await fetch(`${apiBaseUrl}/messages/redact`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${matrixAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = typeof body.errorCode === 'string' ? body.errorCode : 'delete_failed';
    throw new DeleteMessageError(response.status, errorCode);
  }

  return body as DeleteMessageResponse;
}
