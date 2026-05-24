import { describe, expect, it } from 'vitest';
import {
  BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE,
  canOpenChannelChat,
  canSendToChannelChat,
  getBrmbleServiceBootstrapPhase,
  getBrmbleServiceChatNotice,
  getChannelSelectionOutcome,
  getChannelAccessDeniedMessage,
  getChannelChatAccessRequestKey,
  getChannelChatAccessRequestIds,
  getPermittedMatrixChannelId,
  getJoinAccessAction,
  getDeleteMessageFailureDetail,
  getRoomIdForDeleteMessage,
  getResolvedChannelChatAccess,
  isBrmbleServiceOutageActive,
  isMatrixChannelChatActive,
  isStructuredEnterDenied,
  shouldAllowChannelChatSend,
  isTemporaryChannelChatActive,
  mergeChannelChatAccess,
  shouldShowBrmbleServiceWarningNotification,
} from './App';
import type { ServiceStatusMap } from './types';
import type { MatrixCredentials } from './hooks/useMatrixClient';

const credentials: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'token',
  userId: '@me:example.com',
  roomMap: { '1': '!room:example.com' },
};

const connectedStatuses: ServiceStatusMap = {
  voice: { state: 'connected' },
  server: { state: 'connected' },
  chat: { state: 'connected' },
  livekit: { state: 'idle' },
};

const matrixChannels = [
  { id: 1, name: 'Allowed', canOpenChat: true, canSendChat: true },
  { id: 2, name: 'Denied', canOpenChat: false, canSendChat: false },
];

describe('isMatrixChannelChatActive', () => {
  it('uses Matrix only when room, Brmble server, Matrix chat, and self Brmble identity are ready', () => {
    expect(isMatrixChannelChatActive('1', credentials, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: true }, matrixChannels)).toBe(true);
  });

  it('falls back to Mumble when channel chat access is denied', () => {
    expect(isMatrixChannelChatActive('2', {
      ...credentials,
      roomMap: { ...credentials.roomMap, '2': '!denied:example.com' },
    }, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: true }, matrixChannels)).toBe(false);
  });

  it('falls back to Mumble until channel chat access is explicitly allowed', () => {
    expect(isMatrixChannelChatActive('3', {
      ...credentials,
      roomMap: { ...credentials.roomMap, '3': '!unknown:example.com' },
    }, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: true }, [
      ...matrixChannels,
      { id: 3, name: 'Unknown' },
    ])).toBe(false);
  });

  it('falls back to Mumble while Brmble server is reconnecting even if credentials still exist', () => {
    expect(isMatrixChannelChatActive('1', credentials, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, { session: 1, name: 'Me', self: true, isBrmbleClient: true }, matrixChannels)).toBe(false);
  });

  it('falls back to Mumble until Matrix chat is connected', () => {
    expect(isMatrixChannelChatActive('1', credentials, {
      ...connectedStatuses,
      chat: { state: 'connecting' },
    }, { session: 1, name: 'Me', self: true, isBrmbleClient: true }, matrixChannels)).toBe(false);
  });

  it('falls back to Mumble until self is restored as a Brmble client', () => {
    expect(isMatrixChannelChatActive('1', credentials, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: false }, matrixChannels)).toBe(false);
  });
});

describe('channel chat access helpers', () => {
  it('exits DM mode when selecting a channel whose chat cannot be opened', () => {
    expect(getChannelSelectionOutcome(2, matrixChannels, 'dm')).toEqual({
      channelId: '2',
      channelName: 'Denied',
      canOpenChat: false,
      shouldExitDmMode: true,
      shouldClearDmSelection: true,
    });
  });

  it('deduplicates positive channel ids for chat access requests', () => {
    expect(getChannelChatAccessRequestIds([
      { id: 0, name: 'Root' },
      { id: 1, name: 'General' },
      { id: 1, name: 'General duplicate' },
      { id: -2, name: 'Invalid' },
    ])).toEqual([1]);
  });

  it('keeps the chat access request key stable when only access flags change', () => {
    expect(getChannelChatAccessRequestKey([
      { id: 1, name: 'General' },
      { id: 2, name: 'Quiet', canOpenChat: false, canSendChat: false },
    ])).toBe(getChannelChatAccessRequestKey([
      { id: 1, name: 'General', canOpenChat: true, canSendChat: true },
      { id: 2, name: 'Quiet', canOpenChat: true, canSendChat: false },
    ]));
  });

  it('merges canRead and canSend without dropping voice channel state', () => {
    const result = mergeChannelChatAccess([
      { id: 1, name: 'General', isEnterRestricted: true, canEnter: false, hasPasswordRestriction: true },
      { id: 2, name: 'Quiet' },
    ], {
      '1': { canRead: false, canSend: false },
      '2': { canRead: true, canSend: true },
    });

    expect(result[0]).toMatchObject({
      id: 1,
      isEnterRestricted: true,
      canEnter: false,
      hasPasswordRestriction: true,
      canOpenChat: false,
      canSendChat: false,
    });
    expect(result[1]).toMatchObject({ canOpenChat: true, canSendChat: true });
  });

  it('preserves channel array identity when access does not change', () => {
    const channels = [{ id: 1, name: 'General', canOpenChat: true, canSendChat: true }];

    expect(mergeChannelChatAccess(channels, {
      '1': { canRead: true, canSend: true },
    })).toBe(channels);
    expect(mergeChannelChatAccess(channels, {})).toBe(channels);
  });

  it('allows every requested channel when channel chat access fails', () => {
    expect(getResolvedChannelChatAccess([1, 2])).toEqual({
      '1': { canRead: true, canSend: true },
      '2': { canRead: true, canSend: true },
    });
  });

  it('allows server root chat and gates restricted Matrix channels', () => {
    const channels = [
      { id: 1, name: 'Allowed', canOpenChat: true, canSendChat: true },
      { id: 2, name: 'Denied', canOpenChat: false, canSendChat: false },
      { id: 3, name: 'Unknown' },
    ];

    expect(canOpenChannelChat('server-root', channels)).toBe(true);
    expect(canOpenChannelChat('1', channels)).toBe(true);
    expect(canOpenChannelChat('2', channels)).toBe(false);
    expect(canOpenChannelChat('3', channels)).toBe(true);
    expect(canSendToChannelChat('1', channels)).toBe(true);
    expect(canSendToChannelChat('2', channels)).toBe(false);
    expect(canSendToChannelChat('3', channels)).toBe(true);
  });

  it('returns a Matrix-accessible channel only when channel chat can be opened explicitly', () => {
    const channels = [
      { id: 1, name: 'Allowed', canOpenChat: true, canSendChat: true },
      { id: 2, name: 'Denied', canOpenChat: false, canSendChat: false },
      { id: 3, name: 'Unknown' },
    ];

    expect(getPermittedMatrixChannelId('1', channels)).toBe('1');
    expect(getPermittedMatrixChannelId('2', channels)).toBeNull();
    expect(getPermittedMatrixChannelId('3', channels)).toBeNull();
    expect(getPermittedMatrixChannelId('server-root', channels)).toBeNull();
    expect(getPermittedMatrixChannelId(undefined, channels)).toBeNull();
  });

  it('allows sending channel chat while access flags are still loading', () => {
    const channels = [{ id: 3, name: 'Unknown' }];

    expect(shouldAllowChannelChatSend('3', channels, connectedStatuses, 'ready')).toBe(true);
  });

  it('allows temporary channel chat when access flags are denied during Mumble outage mode', () => {
    const channels = [{ id: 3, name: 'Denied', canOpenChat: false, canSendChat: false }];

    expect(shouldAllowChannelChatSend('3', channels, connectedStatuses, 'ready')).toBe(false);
    expect(shouldAllowChannelChatSend('3', channels, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, 'degraded')).toBe(true);
  });

  it('uses the active DM room when deleting a DM message', () => {
    expect(getRoomIdForDeleteMessage({
      appMode: 'dm',
      messageChannelId: '@alice:example.com',
      channelMatrixRoomId: '!channel:example.com',
      dmMatrixRoomId: '!dm:example.com',
    })).toBe('!dm:example.com');
  });

  it('surfaces event-not-found failures instead of showing the generic retry message', () => {
    expect(getDeleteMessageFailureDetail({ status: 404, errorCode: 'event_not_found' })).toBe('The message could not be found in this chat.');
  });
});

describe('structured channel access denial helpers', () => {
  it('classifies Enter permission denials by structured permission field', () => {
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 4, message: 'anything' })).toBe(true);
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 2, message: 'Enter appears in text only' })).toBe(false);
  });

  it('uses password-specific copy only when the channel is known password restricted', () => {
    expect(getChannelAccessDeniedMessage({ hasPasswordRestriction: true })).toBe('Incorrect password or no access.');
    expect(getChannelAccessDeniedMessage({})).toBe('You do not have access to that channel.');
  });
});

describe('getJoinAccessAction', () => {
  it('joins normally when channel is enterable or canEnter is unknown', () => {
    expect(getJoinAccessAction({ canEnter: true })).toBe('join');
    expect(getJoinAccessAction({})).toBe('join');
  });

  it('prompts for password restricted denied channels and denies other restricted channels', () => {
    expect(getJoinAccessAction({ canEnter: false, hasPasswordRestriction: true })).toBe('promptPassword');
    expect(getJoinAccessAction({ hasPasswordRestriction: true })).toBe('promptPassword');
    expect(getJoinAccessAction({ canEnter: false })).toBe('deny');
  });

  it('joins password restricted channels when access is already granted', () => {
    expect(getJoinAccessAction({ canEnter: true, hasPasswordRestriction: true })).toBe('join');
  });
});

describe('isBrmbleServiceOutageActive', () => {
  it('is false when voice, Brmble, and Matrix chat are connected', () => {
    expect(isBrmbleServiceOutageActive(connectedStatuses)).toBe(false);
  });

  it('is true when voice remains connected but Brmble is reconnecting', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(true);
  });

  it('is true when voice remains connected but Matrix chat is disconnected', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      chat: { state: 'disconnected' },
    })).toBe(true);
  });

  it('is false when voice is not connected', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      voice: { state: 'disconnected' },
      server: { state: 'connecting' },
    })).toBe(false);
  });
});

describe('getBrmbleServiceBootstrapPhase', () => {
  it('stays in bootstrap while initial Brmble services are still connecting', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, false, false)).toBe('bootstrap');
  });

  it('stays in bootstrap when initial Brmble service connection fails before the grace period expires', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      server: { state: 'disconnected', error: 'unavailable' },
      chat: { state: 'connecting' },
    }, false, false)).toBe('bootstrap');
  });

  it('becomes degraded when the initial bootstrap grace period expires', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, true, false)).toBe('degraded');
  });

  it('becomes ready once Brmble server and Matrix chat are connected', () => {
    expect(getBrmbleServiceBootstrapPhase(connectedStatuses, false, false)).toBe('ready');
  });

  it('becomes degraded immediately after previously ready services drop', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      chat: { state: 'connecting' },
    }, false, true)).toBe('degraded');
  });

  it('becomes degraded when an initial service failure remains after the grace period expires', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      server: { state: 'disconnected', error: 'unavailable' },
      chat: { state: 'connecting' },
    }, true, false)).toBe('degraded');
  });
});

describe('isTemporaryChannelChatActive', () => {
  it('is true for a normal channel during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, 'degraded')).toBe(true);
  });

  it('is false for a normal channel during initial Brmble service bootstrap', () => {
    expect(isTemporaryChannelChatActive('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, 'bootstrap')).toBe(false);
  });

  it('is false for server root during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('server-root', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, 'degraded')).toBe(false);
  });

  it('is false when no channel is selected', () => {
    expect(isTemporaryChannelChatActive(undefined, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, 'degraded')).toBe(false);
  });

  it('is false when Brmble and Matrix chat are connected', () => {
    expect(isTemporaryChannelChatActive('1', connectedStatuses, 'ready')).toBe(false);
  });
});

describe('getBrmbleServiceChatNotice', () => {
  it('shows a connecting notice during initial Brmble service bootstrap', () => {
    expect(getBrmbleServiceChatNotice('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, 'bootstrap')).toBe(BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE);
    expect(BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE).not.toContain('sync');
  });

  it('shows an unavailable notice after bootstrap degrades', () => {
    expect(getBrmbleServiceChatNotice('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, 'degraded')).toContain('currently unavailable');
  });

  it('does not show a notice at server root', () => {
    expect(getBrmbleServiceChatNotice('server-root', {
      ...connectedStatuses,
      server: { state: 'connecting' },
      chat: { state: 'connecting' },
    }, 'bootstrap')).toBeUndefined();
  });
});

describe('shouldShowBrmbleServiceWarningNotification', () => {
  it('shows the notification during a new outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, false, 'degraded')).toBe(true);
  });

  it('does not re-show the notification after the user dismissed it during the same outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, true, 'degraded')).toBe(false);
  });

  it('does not show the notification when there is no outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(false, false, 'ready')).toBe(false);
  });

  it('does not show the notification during initial Brmble service bootstrap', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, false, 'bootstrap')).toBe(false);
  });

  it('clears the notification outside degraded outages', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, false, 'bootstrap')).toBe(false);
  });
});
