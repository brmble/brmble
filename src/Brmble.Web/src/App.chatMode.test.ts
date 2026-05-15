import { describe, expect, it } from 'vitest';
import { isMatrixChannelChatActive } from './App';
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
