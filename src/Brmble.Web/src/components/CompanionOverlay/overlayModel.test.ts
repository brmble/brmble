import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY } from '../SettingsModal/InterfaceSettingsTypes';
import {
  appendOverlayEvent,
  createChannelMessageOverlayEvent,
  createMembershipOverlayEvent,
  createOverlaySnapshot,
  pruneOverlaySnapshot,
  setSpeakerActivity,
} from './overlayModel';

describe('overlayModel', () => {
  it('keeps only the newest 8 events', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');

    for (let i = 0; i < 10; i += 1) {
      snapshot = appendOverlayEvent(
        snapshot,
        createMembershipOverlayEvent({
          kind: 'user-joined',
          actorName: `User ${i}`,
          currentChannelId: '7',
          eventChannelId: '7',
          timestamp: 1_000 + i,
        }),
        DEFAULT_OVERLAY
      );
    }

    expect(snapshot.recentEvents).toHaveLength(8);
    expect(snapshot.recentEvents[0].line).toBe('User 2 joined the channel');
    expect(snapshot.recentEvents[7].line).toBe('User 9 joined the channel');
  });

  it('uses safe fallback names and speaker decay', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(
      snapshot,
      createChannelMessageOverlayEvent({
        actorName: '',
        text: '',
        channelId: '7',
        currentChannelId: '7',
        timestamp: 2_000,
      }),
      DEFAULT_OVERLAY
    );
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: '', channelId: 7 }, true, 3_000);
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: '', channelId: 7 }, false, 4_000);
    snapshot = pruneOverlaySnapshot(snapshot, 6_600);

    expect(snapshot.recentEvents[0].line).toBe('Unknown user: Message unavailable');
    expect(snapshot.activeSpeakers).toHaveLength(0);
  });

  it('drops text events after five seconds', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(
      snapshot,
      createChannelMessageOverlayEvent({
        actorName: 'Milo',
        text: 'Heads up',
        channelId: '7',
        currentChannelId: '7',
        timestamp: 2_000,
      }),
      DEFAULT_OVERLAY,
    );

    snapshot = pruneOverlaySnapshot(snapshot, 7_001);

    expect(snapshot.recentEvents).toHaveLength(0);
    expect(snapshot.visualState).toBe('quiet');
  });

  it('filters out disabled categories and off-channel events', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(
      snapshot,
      createMembershipOverlayEvent({
        kind: 'user-joined',
        actorName: 'Off Channel',
        currentChannelId: '7',
        eventChannelId: '9',
        timestamp: 5_000,
      }),
      DEFAULT_OVERLAY,
    );
    snapshot = appendOverlayEvent(
      snapshot,
      {
        id: 'dm-1',
        kind: 'direct-message',
        actorName: 'Qy',
        line: 'DM from Qy: ping',
        timestamp: 5_001,
      },
      { ...DEFAULT_OVERLAY, showDirectMessages: false },
    );

    expect(snapshot.recentEvents).toHaveLength(0);
  });
});
