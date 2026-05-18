import { describe, expect, it } from 'vitest';
import {
  BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE,
  getBrmbleServiceBootstrapPhase,
  getBrmbleServiceChatNotice,
  isBrmbleServiceOutageActive,
  isMatrixChannelChatActive,
  isTemporaryChannelChatActive,
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

  it('becomes degraded when initial Brmble service connection fails', () => {
    expect(getBrmbleServiceBootstrapPhase({
      ...connectedStatuses,
      server: { state: 'disconnected', error: 'unavailable' },
      chat: { state: 'connecting' },
    }, false, false)).toBe('degraded');
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
});
