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

/**
 * Group messages for display with date separators, sender grouping, and an
 * unread divider.
 *
 * @param readMarkerTs  Wall-clock timestamp (ms since epoch) of when the user
 *   last read this room.  The unread divider is placed above the first message
 *   whose timestamp exceeds this value.  Using a timestamp instead of an event
 *   ID makes the divider resilient to timeline changes (backfill, pagination,
 *   reconnect) — it always appears above the first truly-new message.
 */
export function groupMessages(messages: ChatMessage[], readMarkerTs?: number | null): GroupedMessage[] {
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

    // Place the divider above the first message that arrived after the read
    // marker timestamp. This mirrors how countUnreadFromTimeline works:
    // only events with origin_server_ts > marker.ts are "unread".
    const showUnreadDivider = !unreadDividerPlaced
      && readMarkerTs != null
      && message.timestamp.getTime() > readMarkerTs;

    if (showUnreadDivider) unreadDividerPlaced = true;

    return { message, isGroupStart, showDateSeparator, showUnreadDivider };
  });
}
