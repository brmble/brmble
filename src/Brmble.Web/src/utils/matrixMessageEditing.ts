import type { ChatMessage } from '../types';

export const MESSAGE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

type ReplacementContent = {
  body?: string;
  msgtype?: string;
  'm.new_content'?: {
    body?: string;
    msgtype?: string;
  };
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
  };
};

type ReplacementEventLike = {
  getType(): string;
  getId?(): string | undefined;
  getSender(): string | undefined;
  getTs(): number;
  getContent(): ReplacementContent;
};

type BundledReplacementEventLike = {
  getId(): string | undefined;
  getUnsigned?(): {
    'm.relations'?: {
      'm.replace'?: {
        event_id?: string;
        origin_server_ts?: number;
        sender?: string;
        content?: ReplacementContent;
      };
    };
  };
};

export interface ParsedReplacementEvent {
  targetEventId: string;
  senderId: string;
  body: string;
  editEventId: string;
  timestamp: number;
}

export function getEditedBody(content: ReplacementContent): string | null {
  const newContent = content['m.new_content'];
  if (newContent?.msgtype !== 'm.text') return null;
  return typeof newContent.body === 'string' ? newContent.body : null;
}

export function isReplacementEvent(event: ReplacementEventLike): boolean {
  if (event.getType() !== 'm.room.message') return false;
  const content = event.getContent();
  return content['m.relates_to']?.rel_type === 'm.replace'
    && typeof content['m.relates_to']?.event_id === 'string'
    && getEditedBody(content) !== null;
}

export function parseReplacementEvent(event: ReplacementEventLike): ParsedReplacementEvent | null {
  if (!isReplacementEvent(event)) return null;
  const senderId = event.getSender();
  const editEventId = event.getId?.();
  const content = event.getContent();
  const targetEventId = content['m.relates_to']?.event_id;
  const body = getEditedBody(content);
  if (!senderId || !targetEventId || body == null || !editEventId) return null;

  return {
    targetEventId,
    senderId,
    body,
    editEventId,
    timestamp: event.getTs(),
  };
}

export function parseBundledReplacementFromUnsigned(
  event: BundledReplacementEventLike,
): ParsedReplacementEvent | null {
  const targetEventId = event.getId();
  const bundled = event.getUnsigned?.()?.['m.relations']?.['m.replace'];
  const body = bundled?.content ? getEditedBody(bundled.content) : null;
  if (!targetEventId || !bundled?.event_id || !bundled.sender || body == null || typeof bundled.origin_server_ts !== 'number') {
    return null;
  }

  return {
    targetEventId,
    senderId: bundled.sender,
    body,
    editEventId: bundled.event_id,
    timestamp: bundled.origin_server_ts,
  };
}

export function compareReplacementEdits(a: ParsedReplacementEvent, b: ParsedReplacementEvent): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.editEventId.localeCompare(b.editEventId);
}

export function buildMessageEditContent(originalEventId: string, body: string) {
  return {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': {
      msgtype: 'm.text',
      body,
    },
    'm.relates_to': {
      rel_type: 'm.replace',
      event_id: originalEventId,
    },
  };
}

export function canEditMessage(
  message: ChatMessage,
  currentUserMatrixId: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!currentUserMatrixId) return false;
  if (message.type === 'system') return false;
  if (message.senderMatrixUserId !== currentUserMatrixId) return false;
  if ((message.msgType ?? 'm.text') !== 'm.text') return false;
  if (message.pending || message.error || message.redacted) return false;
  if (message.media && message.media.length > 0) return false;

  return nowMs - message.timestamp.getTime() <= MESSAGE_EDIT_WINDOW_MS;
}
