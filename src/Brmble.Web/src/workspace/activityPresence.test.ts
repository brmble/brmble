import { describe, it, expect } from 'vitest';
import {
  activityChannelMatchesPresence,
  channelActivityRoomName,
  parseChannelActivityRoomName,
} from './activityPresence';
import { SERVER_ROOT_CHANNEL_ID } from './presence';

describe('activityChannelMatchesPresence', () => {
  it('matches when the activity belongs to the joined channel', () => {
    expect(activityChannelMatchesPresence('7', '7')).toBe(true);
  });

  it('rejects an activity owned by a different channel', () => {
    expect(activityChannelMatchesPresence('7', '12')).toBe(false);
  });

  it('rejects when not standing in any channel', () => {
    expect(activityChannelMatchesPresence(null, '7')).toBe(false);
  });

  it('rejects server-root because it owns no activities', () => {
    expect(activityChannelMatchesPresence(SERVER_ROOT_CHANNEL_ID, SERVER_ROOT_CHANNEL_ID)).toBe(false);
    expect(activityChannelMatchesPresence(SERVER_ROOT_CHANNEL_ID, '7')).toBe(false);
  });

  it('rejects an activity with no owning channel', () => {
    expect(activityChannelMatchesPresence('7', null)).toBe(false);
    expect(activityChannelMatchesPresence('7', undefined)).toBe(false);
  });
});

describe('channelActivityRoomName', () => {
  it('encodes a channel id as a livekit room name', () => {
    expect(channelActivityRoomName('7')).toBe('channel-7');
  });

  it('round-trips through the parser', () => {
    for (const id of ['7', '12', '0', SERVER_ROOT_CHANNEL_ID]) {
      expect(parseChannelActivityRoomName(channelActivityRoomName(id))).toBe(id);
    }
  });
});

describe('parseChannelActivityRoomName', () => {
  it('extracts the channel id', () => {
    expect(parseChannelActivityRoomName('channel-7')).toBe('7');
  });

  it('preserves ids that themselves contain hyphens', () => {
    expect(parseChannelActivityRoomName('channel-server-root')).toBe(SERVER_ROOT_CHANNEL_ID);
    expect(parseChannelActivityRoomName('channel-7-extra')).toBe('7-extra');
  });

  it('rejects an empty channel id', () => {
    expect(parseChannelActivityRoomName('channel-')).toBeNull();
  });

  it('rejects a non-matching prefix', () => {
    expect(parseChannelActivityRoomName('room-7')).toBeNull();
    expect(parseChannelActivityRoomName('channel7')).toBeNull();
    expect(parseChannelActivityRoomName('')).toBeNull();
    expect(parseChannelActivityRoomName('xchannel-7')).toBeNull();
  });
});
