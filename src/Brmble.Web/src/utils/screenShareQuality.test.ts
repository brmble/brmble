import { describe, expect, it } from 'vitest';
import { ConnectionQuality } from 'livekit-client';
import { mapLiveKitQuality, worstQuality } from './screenShareQuality';

describe('screenShareQuality', () => {
  it('maps LiveKit quality values to screen-share quality states', () => {
    expect(mapLiveKitQuality(ConnectionQuality.Excellent)).toBe('good');
    expect(mapLiveKitQuality(ConnectionQuality.Good)).toBe('fair');
    expect(mapLiveKitQuality(ConnectionQuality.Poor)).toBe('poor');
    expect(mapLiveKitQuality(ConnectionQuality.Lost)).toBe('poor');
    expect(mapLiveKitQuality(ConnectionQuality.Unknown)).toBe('unknown');
  });

  it('returns the worst quality from active quality states', () => {
    expect(worstQuality(['good'])).toBe('good');
    expect(worstQuality(['good', 'fair', 'poor'])).toBe('poor');
    expect(worstQuality(['good', 'unknown', 'fair'])).toBe('fair');
    expect(worstQuality(['good', 'poor', 'reconnecting'])).toBe('reconnecting');
  });

  it('defaults to unknown for an empty quality collection', () => {
    expect(worstQuality([])).toBe('unknown');
  });
});
