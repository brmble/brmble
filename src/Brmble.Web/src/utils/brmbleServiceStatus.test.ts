import { describe, expect, it } from 'vitest';
import { mapBrmbleServiceStatus } from './brmbleServiceStatus';

describe('mapBrmbleServiceStatus', () => {
  it('maps server to the server service dot', () => {
    expect(mapBrmbleServiceStatus({ service: 'server', state: 'connected' })).toEqual({
      service: 'server',
      update: { state: 'connected', error: undefined },
    });
  });

  it('maps session reconnecting to the server service dot with realtime label', () => {
    expect(mapBrmbleServiceStatus({ service: 'session', state: 'reconnecting', reason: 'connection-lost' })).toEqual({
      service: 'server',
      update: { state: 'connecting', error: 'Session reconnecting: connection-lost' },
    });
  });

  it('maps screenshare disconnected to the livekit service dot', () => {
    expect(mapBrmbleServiceStatus({ service: 'screenshare', state: 'disconnected', reason: 'token-request-failed' })).toEqual({
      service: 'livekit',
      update: { state: 'disconnected', error: 'token-request-failed' },
    });
  });
});
