import type { ChatMessage } from '../types';

const GROUP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface GroupedMessage {
  message: ChatMessage;
  isGroupStart: boolean;
  showDateSeparator: boolean;
  showUnreadDivider: boolean;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function groupMessages(messages: ChatMessage[], fullyReadEventId?: string | null): GroupedMessage[] {
  let unreadDividerPlaced = false;

  return messages.map((message, index) => {
    const prev = index > 0 ? messages[index - 1] : null;

    const showDateSeparator = !prev || !isSameDay(prev.timestamp, message.timestamp);

    const isGroupStart =
      !prev ||
      prev.sender !== message.sender ||
      message.type === 'system' ||
      prev.type === 'system' ||
      showDateSeparator ||
      message.timestamp.getTime() - prev.timestamp.getTime() > GROUP_THRESHOLD_MS;

    const showUnreadDivider = !unreadDividerPlaced
      && fullyReadEventId != null
      && prev != null
      && prev.id === fullyReadEventId;

    if (showUnreadDivider) unreadDividerPlaced = true;

    return { message, isGroupStart, showDateSeparator, showUnreadDivider };
  });
}
