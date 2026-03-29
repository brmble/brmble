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
 * @param currentUsername  The current user's display name.  When provided, the
 *   divider is never placed above the user's own messages — it skips past them
 *   to land on the first message from another user.  This prevents clock skew
 *   between the client and homeserver from causing the divider to appear above
 *   the user's own last sent message.
 */
export function groupMessages(
  messages: ChatMessage[],
  readMarkerTs?: number | null,
  currentUsername?: string,
): GroupedMessage[] {
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

    // Place the divider above the first message from ANOTHER user that arrived
    // after the read marker timestamp.  Skip own messages because the marker is
    // saved with Date.now() when the local echo fires, but the server may
    // assign a slightly later origin_server_ts — causing a false "unread" on
    // the user's own message due to clock skew.
    const isOwnMessage = currentUsername != null
      && message.sender === currentUsername
      && message.type !== 'system';

    const showUnreadDivider = !unreadDividerPlaced
      && readMarkerTs != null
      && message.timestamp.getTime() > readMarkerTs
      && !isOwnMessage;

    if (showUnreadDivider) unreadDividerPlaced = true;

    return { message, isGroupStart, showDateSeparator, showUnreadDivider };
  });
}
