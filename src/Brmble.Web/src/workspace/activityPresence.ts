import { SERVER_ROOT_CHANNEL_ID } from './presence';

const CHANNEL_ROOM_PREFIX = 'channel-';

/**
 * An activity (paint session, screen share, ...) is alive only while you are standing
 * in the channel that owns it. Server-root owns nothing.
 */
export function activityChannelMatchesPresence(
  joinedChannelId: string | null,
  activityChannelId: string | null | undefined,
): boolean {
  if (joinedChannelId === null || joinedChannelId === SERVER_ROOT_CHANNEL_ID) return false;
  if (activityChannelId === null || activityChannelId === undefined) return false;
  return activityChannelId === joinedChannelId;
}

/** Encodes a channel id as the LiveKit room name used for that channel's activities. */
export function channelActivityRoomName(channelId: string): string {
  return `${CHANNEL_ROOM_PREFIX}${channelId}`;
}

/**
 * Inverse of {@link channelActivityRoomName}. Returns null when the name is not a
 * channel activity room.
 *
 * Everything after the first `channel-` is treated as the id, so ids that themselves
 * contain hyphens (notably `server-root`) round-trip. An empty id is rejected.
 */
export function parseChannelActivityRoomName(roomName: string): string | null {
  if (!roomName.startsWith(CHANNEL_ROOM_PREFIX)) return null;
  const channelId = roomName.slice(CHANNEL_ROOM_PREFIX.length);
  return channelId.length > 0 ? channelId : null;
}
