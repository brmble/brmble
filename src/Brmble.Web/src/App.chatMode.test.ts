import { describe, expect, it } from 'vitest';
import {
  canOpenChannelChat,
  canSendToChannelChat,
  getChannelAccessDeniedMessage,
  isBrmbleServiceOutageActive,
  isMatrixChannelChatActive,
  isStructuredEnterDenied,
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

describe('isMatrixChannelChatActive', () => {
  it('uses Matrix only when room, Brmble server, Matrix chat, and self Brmble identity are ready', () => {
    expect(isMatrixChannelChatActive('1', credentials, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: true })).toBe(true);
  });

  it('falls back to Mumble while Brmble server is reconnecting even if credentials still exist', () => {
    expect(isMatrixChannelChatActive('1', credentials, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    }, { session: 1, name: 'Me', self: true, isBrmbleClient: true })).toBe(false);
  });

  it('falls back to Mumble until Matrix chat is connected', () => {
    expect(isMatrixChannelChatActive('1', credentials, {
      ...connectedStatuses,
      chat: { state: 'connecting' },
    }, { session: 1, name: 'Me', self: true, isBrmbleClient: true })).toBe(false);
  });

  it('falls back to Mumble until self is restored as a Brmble client', () => {
    expect(isMatrixChannelChatActive('1', credentials, connectedStatuses, { session: 1, name: 'Me', self: true, isBrmbleClient: false })).toBe(false);
  });
});

describe('channel chat access helpers', () => {
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

  it('allows server root chat and gates restricted Matrix channels', () => {
    const channels = [
      { id: 1, name: 'Allowed', canOpenChat: true, canSendChat: true },
      { id: 2, name: 'Denied', canOpenChat: false, canSendChat: false },
    ];

    expect(canOpenChannelChat('server-root', channels)).toBe(true);
    expect(canOpenChannelChat('1', channels)).toBe(true);
    expect(canOpenChannelChat('2', channels)).toBe(false);
    expect(canSendToChannelChat('1', channels)).toBe(true);
    expect(canSendToChannelChat('2', channels)).toBe(false);
  });
});

describe('structured channel access denial helpers', () => {
  it('classifies Enter permission denials by structured permission field', () => {
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 2, message: 'anything' })).toBe(true);
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 4, message: 'Enter appears in text only' })).toBe(false);
  });

  it('uses password-specific copy only when the channel is known password restricted', () => {
    expect(getChannelAccessDeniedMessage({ hasPasswordRestriction: true })).toBe('Incorrect password or no access.');
    expect(getChannelAccessDeniedMessage({})).toBe('You do not have access to that channel.');
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

describe('isTemporaryChannelChatActive', () => {
  it('is true for a normal channel during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(true);
  });

  it('is false for server root during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('server-root', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(false);
  });

  it('is false when no channel is selected', () => {
    expect(isTemporaryChannelChatActive(undefined, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(false);
  });

  it('is false when Brmble and Matrix chat are connected', () => {
    expect(isTemporaryChannelChatActive('1', connectedStatuses)).toBe(false);
  });
});

describe('shouldShowBrmbleServiceWarningNotification', () => {
  it('shows the notification during a new outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, false)).toBe(true);
  });

  it('does not re-show the notification after the user dismissed it during the same outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, true)).toBe(false);
  });

  it('does not show the notification when there is no outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(false, false)).toBe(false);
  });
});
