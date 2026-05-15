import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OVERLAY } from '../SettingsModal/InterfaceSettingsTypes';
import {
  appendOverlayEvent,
  createChannelMessageOverlayEvent,
  createMembershipOverlayEvent,
  createServerMembershipOverlayEvent,
  createOverlaySnapshot,
  pruneOverlaySnapshot,
  resolveFullCompanionDisplay,
  setSpeakerActivity,
  updateFullCompanionContext,
} from './overlayModel';

describe('overlayModel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('creates full companion defaults for local idle display', () => {
    const snapshot = createOverlaySnapshot('7', 'Raid');

    expect(snapshot.fullCompanion).toEqual({
      activeDisplay: null,
      chatQueue: [],
      eventQueue: [],
      speakerCandidates: [],
      companionsByUser: {},
      localUser: {
        session: 0,
        name: 'You',
        companionId: 'floppy',
      },
      flags: {
        localMuted: false,
        liveUserSessions: [],
      },
    });
  });

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

    expect(snapshot.activeSpeakers).toEqual([
      expect.objectContaining({
        isSpeaking: false,
        name: 'Unknown user',
      }),
    ]);
    expect(snapshot.recentEvents[0].line).toBe('Unknown user: Message unavailable');

    snapshot = pruneOverlaySnapshot(snapshot, 7_100);

    expect(snapshot.recentEvents).toHaveLength(0);
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

  it('shows idle with local companion on row 1 when no work is pending', () => {
    const snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'idle',
      representedSession: 0,
      representedName: 'You',
      companionId: 'floppy',
      row: 1,
      bubble: null,
      expiresAt: null,
    }));
  });

  it('refreshes the idle display when the local companion changes', () => {
    let snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

    snapshot = updateFullCompanionContext(snapshot, {
      localUser: {
        companionId: 'engineer',
      },
    });

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'idle',
      companionId: 'engineer',
    }));
  });

  it('chat preempts idle and expires after five seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000));

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

    snapshot = resolveFullCompanionDisplay(snapshot, 2_000);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'chat',
      representedName: 'Milo',
      row: 4,
      bubble: 'Milo: Heads up',
      expiresAt: 7_000,
    }));

    snapshot = resolveFullCompanionDisplay(snapshot, 7_001);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'idle',
      row: 1,
    }));
  });

  it('serializes multiple chats through the chat queue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));

    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(snapshot, {
      id: 'chat-1',
      kind: 'channel-message',
      actorName: 'Milo',
      line: 'Milo: first',
      timestamp: 1_000,
      channelId: '7',
    }, DEFAULT_OVERLAY);
    snapshot = resolveFullCompanionDisplay(snapshot, 1_000);
    snapshot = appendOverlayEvent(snapshot, {
      id: 'chat-2',
      kind: 'channel-message',
      actorName: 'Qy',
      line: 'Qy: second',
      timestamp: 1_100,
      channelId: '7',
    }, DEFAULT_OVERLAY);

    expect(snapshot.fullCompanion.activeDisplay?.bubble).toBe('Milo: first');
    expect(snapshot.fullCompanion.chatQueue.map((event) => event.line)).toEqual(['Qy: second']);

    snapshot = resolveFullCompanionDisplay(snapshot, 6_001);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'chat',
      representedName: 'Qy',
      bubble: 'Qy: second',
      startedAt: 6_001,
      expiresAt: 11_001,
    }));
  });

  it('promotes speakers only after half a second of continuous speech', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);

    snapshot = resolveFullCompanionDisplay(snapshot, 1_499);
    expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('idle');

    snapshot = resolveFullCompanionDisplay(snapshot, 1_500);
    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'speaking',
      representedSession: 11,
      representedName: 'Milo',
      row: 9,
      bubble: null,
    }));
  });

  it('uses the selected local companion when the local user becomes the active speaker', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localUser: {
        session: 42,
        name: 'You',
        companionId: 'engineer',
      },
      companionsByUser: {
        42: {
          session: 42,
          name: 'You',
          companionId: 'bee',
        },
      },
    });
    snapshot = setSpeakerActivity(snapshot, { session: 42, name: 'You', channelId: 7 }, true, 1_000);

    snapshot = resolveFullCompanionDisplay(snapshot, 1_500);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'speaking',
      representedSession: 42,
      companionId: 'engineer',
    }));
  });

  it('uses the local companion as a proxy when another user speaks without their own companion', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localUser: {
        session: 42,
        name: 'You',
        companionId: 'retro',
      },
      companionsByUser: {
        99: {
          session: 99,
          name: 'Milo',
        },
      },
    });
    snapshot = setSpeakerActivity(snapshot, { session: 99, name: 'Milo', channelId: 7 }, true, 1_000);

    snapshot = resolveFullCompanionDisplay(snapshot, 1_500);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'speaking',
      representedSession: 99,
      companionId: 'retro',
      isProxy: true,
    }));
  });

  it('refreshes an active remote speaking display when companion data arrives later', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localUser: {
        session: 42,
        name: 'You',
        companionId: 'floppy',
      },
      companionsByUser: {
        99: {
          session: 99,
          name: 'Milo',
        },
      },
    });
    snapshot = setSpeakerActivity(snapshot, { session: 99, name: 'Milo', channelId: 7 }, true, 1_000);
    snapshot = resolveFullCompanionDisplay(snapshot, 1_500);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'speaking',
      representedSession: 99,
      companionId: 'floppy',
      isProxy: true,
    }));

    snapshot = updateFullCompanionContext(snapshot, {
      companionsByUser: {
        99: {
          session: 99,
          name: 'Milo',
          companionId: 'retro',
        },
      },
    });

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'speaking',
      representedSession: 99,
      companionId: 'retro',
      isProxy: false,
    }));
  });

  it('uses the local companion as a proxy for join events when another user has no companion', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localUser: {
        session: 42,
        name: 'You',
        companionId: 'retro',
      },
      companionsByUser: {
        99: {
          session: 99,
          name: 'Milo',
        },
      },
    });
    snapshot = appendOverlayEvent(snapshot, {
      id: 'join-1',
      kind: 'user-joined',
      actorName: 'Milo',
      line: 'Milo joined the channel',
      timestamp: 1_000,
      channelId: '7',
    }, DEFAULT_OVERLAY);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'join',
      representedSession: 99,
      companionId: 'retro',
      isProxy: true,
    }));
  });

  it('keeps chat ahead of eligible speakers', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = appendOverlayEvent(snapshot, {
      id: 'chat-1',
      kind: 'channel-message',
      actorName: 'Qy',
      line: 'Qy: hold on',
      timestamp: 1_000,
      channelId: '7',
    }, DEFAULT_OVERLAY);
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_100);
    snapshot = resolveFullCompanionDisplay(snapshot, 1_700);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'chat',
      representedName: 'Qy',
    }));
  });

  it('queues join and leave behind chat and speaking', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
    snapshot = resolveFullCompanionDisplay(snapshot, 1_500);
    snapshot = appendOverlayEvent(snapshot, {
      id: 'join-1',
      kind: 'user-joined',
      actorName: 'Kira',
      line: 'Kira joined the channel',
      timestamp: 1_600,
      channelId: '7',
    }, DEFAULT_OVERLAY);

    expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('speaking');
    expect(snapshot.fullCompanion.eventQueue.map((event) => event.line)).toEqual(['Kira joined the channel']);
  });

  it('local mute suppresses speaker displays and active speaking indicators only', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localMuted: true,
    });
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
    snapshot = resolveFullCompanionDisplay(snapshot, 1_600);

    expect(snapshot.fullCompanion.activeDisplay?.kind).toBe('idle');
    expect(snapshot.activeSpeakers).toHaveLength(0);

    snapshot = appendOverlayEvent(snapshot, {
      id: 'chat-1',
      kind: 'channel-message',
      actorName: 'Milo',
      line: 'Milo: still visible',
      timestamp: 2_000,
      channelId: '7',
    }, DEFAULT_OVERLAY);

    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'chat',
      bubble: 'Milo: still visible',
    }));
  });

  it('keeps stopped speakers cooling in indicators before removing them', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, true, 1_000);
    snapshot = setSpeakerActivity(snapshot, { session: 11, name: 'Milo', channelId: 7 }, false, 1_600);

    expect(snapshot.activeSpeakers).toEqual([
      expect.objectContaining({
        session: 11,
        isSpeaking: false,
        expiresAt: 4_600,
      }),
    ]);

    snapshot = pruneOverlaySnapshot(snapshot, 4_601);

    expect(snapshot.activeSpeakers).toHaveLength(0);
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

  it('includes server-level join/leave events regardless of current channel', () => {
    let snapshot = createOverlaySnapshot('7', 'Raid');

    snapshot = appendOverlayEvent(
      snapshot,
      createServerMembershipOverlayEvent({
        kind: 'user-left',
        actorName: 'MjG',
        line: 'MjG disconnected from the server',
        timestamp: 1_000,
      }),
      DEFAULT_OVERLAY,
    );

    expect(snapshot.recentEvents).toEqual([
      expect.objectContaining({
        kind: 'user-left',
        actorName: 'MjG',
        line: 'MjG disconnected from the server',
      }),
    ]);
    expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
      kind: 'leave',
      bubble: 'MjG disconnected from the server',
    }));
  });
});
