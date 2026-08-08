import type { ChatMessage } from '../types';

export const DEFAULT_MESSAGE_DELETION_WINDOW_MS = 86_400_000;

export function canDeleteMessage(
  message: ChatMessage,
  matrixRoomId: string | null | undefined,
  currentUserMatrixId: string | undefined,
  canModerate: boolean,
  maxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  if (!matrixRoomId || !currentUserMatrixId || !message.id.startsWith('$')
    || message.type === 'system' || Boolean(message.gameType)
    || message.pending || message.error || message.redacted) return false;

  const ageMs = nowMs - message.timestamp.getTime();
  if (!Number.isFinite(ageMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0
    || ageMs < 0 || ageMs >= maxAgeMs) return false;

  return message.senderMatrixUserId === currentUserMatrixId || canModerate;
}
