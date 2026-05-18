import { ConnectionQuality } from 'livekit-client';

export type ScreenShareQuality = 'unknown' | 'good' | 'fair' | 'poor' | 'reconnecting';

export function mapLiveKitQuality(q: ConnectionQuality): ScreenShareQuality {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 'good';
    case ConnectionQuality.Good:
      return 'fair';
    case ConnectionQuality.Poor:
    case ConnectionQuality.Lost:
      return 'poor';
    case ConnectionQuality.Unknown:
    default:
      return 'unknown';
  }
}

const QUALITY_RANK: Record<ScreenShareQuality, number> = {
  reconnecting: 4,
  poor: 3,
  fair: 2,
  good: 1,
  unknown: 0,
};

/** Returns the worst quality from a collection, preferring reconnecting > poor > fair > good > unknown. */
export function worstQuality(qualities: Iterable<ScreenShareQuality>): ScreenShareQuality {
  let worst: ScreenShareQuality = 'unknown';
  for (const q of qualities) {
    if (QUALITY_RANK[q] > QUALITY_RANK[worst]) {
      worst = q;
    }
  }
  return worst;
}
