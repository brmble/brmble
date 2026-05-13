import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as AppModule from './App';
import {
  createQueuedScreenShareEndedNotification,
  createWatchedShareEndedNotification,
  WatchedShareEndedNotifications,
  getMovedChannelNotification,
  getScreenShareEndedNotification,
  runIntentionalDisconnect,
  shouldTreatMoveAsSharingRelated,
} from './App';
import { useNotificationQueue } from './hooks/useNotificationQueue';

type ReplaceScreenShareEndedNotification = (
  current: ReturnType<typeof createQueuedScreenShareEndedNotification>,
  reason: 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel',
  sequence: number,
  notifQueue: { unregister: (id: string) => void },
) => ReturnType<typeof createQueuedScreenShareEndedNotification>;

describe('getScreenShareEndedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps manual share endings silent', () => {
    expect(getScreenShareEndedNotification('manual')).toBeNull();
  });

  it('keeps moved-channel share endings silent because the move notification owns the message', () => {
    expect(getScreenShareEndedNotification('moved-channel')).toBeNull();
  });

  it('returns null notification for manual share stop', () => {
    expect(getScreenShareEndedNotification('manual')).toBeNull();
  });

  it('maps source-closed to an info notification', () => {
    expect(getScreenShareEndedNotification('source-closed')).toEqual({
      status: 'info',
      title: 'Share ended',
      detail: 'Your screen share ended because the shared window or program was closed.',
    });
  });

  it('maps interrupted to an info notification', () => {
    expect(getScreenShareEndedNotification('interrupted')).toEqual({
      status: 'info',
      title: 'Share ended',
      detail: 'Your screen share ended because of an unexpected technical issue.',
    });
  });

  it('maps blocked-capture to a clearer error notification', () => {
    expect(getScreenShareEndedNotification('blocked-capture')).toEqual({
      status: 'error',
      title: 'Screen share failed',
      detail: 'Brmble could not start or keep your screen share running. Windows may have blocked sharing that app or window.',
    });
  });

  it('maps error to the generic technical issue notification', () => {
    expect(getScreenShareEndedNotification('error')).toEqual({
      status: 'error',
      title: 'Screen share failed',
      detail: 'Brmble could not keep your screen share running because of a technical issue.',
    });
  });

  it('requeues share-ended notifications with fresh queue metadata', () => {
    const { result } = renderHook(() => useNotificationQueue());

    act(() => {
      result.current.register('warning-1', 'warning');
      result.current.register('warning-2', 'warning');
      result.current.register('warning-3', 'warning');
    });

    const interrupted = createQueuedScreenShareEndedNotification('interrupted', 0);
    expect(interrupted).not.toBeNull();

    act(() => {
      result.current.register(interrupted!.id, interrupted!.status);
    });

    expect(result.current.isVisible(interrupted!.id)).toBe(false);

    const errored = createQueuedScreenShareEndedNotification('error', 1);
    expect(errored).not.toBeNull();
    expect(errored!.id).not.toBe(interrupted!.id);

    act(() => {
      result.current.unregister(interrupted!.id);
      result.current.register(errored!.id, errored!.status);
    });

    expect(result.current.isVisible(errored!.id)).toBe(true);
    expect(result.current.isVisible('warning-3')).toBe(false);
  });

  it('automatically unregisters the previous share-ended queue id when App replaces it', () => {
    const replaceScreenShareEndedNotification = (AppModule as {
      replaceScreenShareEndedNotification?: ReplaceScreenShareEndedNotification;
    }).replaceScreenShareEndedNotification;
    const unregister = vi.fn();
    const interrupted = createQueuedScreenShareEndedNotification('interrupted', 0);

    expect(replaceScreenShareEndedNotification).toBeTypeOf('function');

    const errored = replaceScreenShareEndedNotification!(
      interrupted,
      'error',
      1,
      { unregister },
    );

    expect(unregister).toHaveBeenCalledWith(interrupted!.id);
    expect(errored).toEqual(createQueuedScreenShareEndedNotification('error', 1));
  });

  it('does not create a queued notification for manual share stop', () => {
    expect(createQueuedScreenShareEndedNotification('manual', 1)).toBeNull();
  });
});

describe('createWatchedShareEndedNotification', () => {
  it('returns notification text for a watched share ended normally', () => {
    expect(createWatchedShareEndedNotification({
      roomName: 'channel-1',
      userName: 'alice',
      userId: 10,
      matrixUserId: '@alice:test',
    }, 'ended', 0)).toEqual({
      id: 'watched-share-ended-0',
      status: 'info',
      title: 'Share ended',
      detail: "alice's share ended.",
    });
  });

  it('returns notification text for a watched share ended unexpectedly', () => {
    expect(createWatchedShareEndedNotification({
      roomName: 'channel-1',
      userName: 'alice',
      userId: 10,
      matrixUserId: '@alice:test',
    }, 'unexpected', 1)).toEqual({
      id: 'watched-share-ended-1',
      status: 'info',
      title: 'Share ended unexpectedly',
      detail: "alice's share ended because the screen-share connection was interrupted.",
    });
  });

  it('renders multiple watched share ended notifications', () => {
    const notifications = [
      createWatchedShareEndedNotification({ roomName: 'channel-1', userName: 'alice', userId: 10 }, 'ended', 0),
      createWatchedShareEndedNotification({ roomName: 'channel-1', userName: 'bob', userId: 20 }, 'unexpected', 1),
    ];
    const notifQueue = {
      isVisible: vi.fn(() => true),
      unregister: vi.fn(),
    };

    render(React.createElement(WatchedShareEndedNotifications, {
      notifications,
      notifQueue,
      onRemove: vi.fn(),
    }));

    expect(screen.getByText("alice's share ended.")).toBeInTheDocument();
    expect(screen.getByText("bob's share ended because the screen-share connection was interrupted.")).toBeInTheDocument();
  });
});

describe('getMovedChannelNotification', () => {
  it('mentions actor and stopped sharing when a move interrupts sharing', () => {
    expect(getMovedChannelNotification({
      actorName: 'Moderator',
      previousChannelName: 'General',
      channelName: 'Raid',
      wasSharing: true,
    })).toEqual({
      status: 'info',
      title: 'Moved to Raid',
      detail: 'Moderator moved you from General to Raid. Screen sharing was stopped.',
    });
  });

  it('uses generic wording when actor and previous channel are unknown', () => {
    expect(getMovedChannelNotification({
      actorName: undefined,
      previousChannelName: undefined,
      channelName: 'Raid',
      wasSharing: false,
    })).toEqual({
      status: 'info',
      title: 'Moved to Raid',
      detail: 'You were moved to Raid.',
    });
  });
});

describe('shouldTreatMoveAsSharingRelated', () => {
  it('treats a move as sharing-related when the sharing channel ref is still set', () => {
    expect(shouldTreatMoveAsSharingRelated({
      isSharing: false,
      isLocalShareStartPending: false,
      sharingChannelId: '2',
      currentShareEndedNotification: null,
    })).toBe(true);
  });

  it('treats a move as sharing-related while a local share start is pending', () => {
    expect(shouldTreatMoveAsSharingRelated({
      isSharing: false,
      isLocalShareStartPending: true,
      sharingChannelId: undefined,
      currentShareEndedNotification: null,
    })).toBe(true);
  });

  it('treats a move as sharing-related when a share-ended notification already exists', () => {
    expect(shouldTreatMoveAsSharingRelated({
      isSharing: false,
      isLocalShareStartPending: false,
      sharingChannelId: undefined,
      currentShareEndedNotification: createQueuedScreenShareEndedNotification('error', 1),
    })).toBe(true);
  });

  it('does not treat a move as sharing-related when no share signal exists', () => {
    expect(shouldTreatMoveAsSharingRelated({
      isSharing: false,
      isLocalShareStartPending: false,
      sharingChannelId: undefined,
      currentShareEndedNotification: null,
    })).toBe(false);
  });
});

describe('runIntentionalDisconnect', () => {
  it('marks manual intent and stops sharing before disconnecting', async () => {
    const events: string[] = [];
    const markLocalShareTeardownIntent = vi.fn(() => {
      events.push('mark');
    });
    const stopSharing = vi.fn(async () => {
      events.push('stop');
    });
    const disconnect = vi.fn(() => {
      events.push('disconnect');
    });

    await runIntentionalDisconnect({
      isSharing: true,
      stopSharing,
      markLocalShareTeardownIntent,
      disconnect,
    });

    expect(markLocalShareTeardownIntent).toHaveBeenCalledWith('manual');
    expect(stopSharing).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['mark', 'stop', 'disconnect']);
  });

  it('runs back-to-server follow-up after disconnecting when sharing', async () => {
    const events: string[] = [];
    const markLocalShareTeardownIntent = vi.fn(() => {
      events.push('mark');
    });
    const stopSharing = vi.fn(async () => {
      events.push('stop');
    });
    const disconnect = vi.fn(() => {
      events.push('disconnect');
    });
    const afterDisconnect = vi.fn(() => {
      events.push('after');
    });

    await runIntentionalDisconnect({
      isSharing: true,
      stopSharing,
      markLocalShareTeardownIntent,
      disconnect,
      afterDisconnect,
    });

    expect(markLocalShareTeardownIntent).toHaveBeenCalledWith('manual');
    expect(stopSharing).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(afterDisconnect).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['mark', 'stop', 'disconnect', 'after']);
  });
});
