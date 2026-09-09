export interface PresenceUser {
  self?: boolean;
  channelId?: number;
}

export const SERVER_ROOT_CHANNEL_ID = 'server-root';

export function selectJoinedChannelId(users: PresenceUser[]): string | null {
  const self = users.find(user => user.self);
  if (!self || self.channelId == null) return null;
  return self.channelId === 0 ? SERVER_ROOT_CHANNEL_ID : String(self.channelId);
}
