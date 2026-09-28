/**
 * Tracks the offset between the server's wall clock and this client's.
 *
 * Snapshots are stamped with the server's clock (`generatedAtUnixMs`) but the
 * render point is chosen from the client's, so the two have to be reconciled
 * before the interpolation buffer means anything. Two unsynchronised clocks
 * slide the render point along the buffer — or off the end of it — and the
 * remote player is then drawn either deep in the past or frozen between
 * snapshots. Both machines share a clock in local dev and in every test, so
 * this only ever shows up across a real network.
 *
 * A single sample gives `serverSentAt - clientReceivedAt`, which is
 * `offset - oneWayLatency`. Latency is never negative, so every sample
 * *underestimates* the offset and the largest one in the window — the packet
 * that travelled fastest — is the best estimate available. Averaging would bake
 * in the mean latency instead; a plain running maximum would latch onto one
 * lucky early packet and never let go. A bounded window keeps the estimate
 * tracking genuine drift, and recovers from a clock step (an NTP correction, a
 * laptop waking) within `windowSize` samples — 2 s at the 20 Hz snapshot rate.
 */

/** 40 samples is 2 s at the 20 Hz snapshot rate. */
export const DEFAULT_SAMPLE_WINDOW = 40;

export interface ServerClock {
  /**
   * Record one server timestamp and the client time it arrived at. Pass
   * `receivedAtUnixMs` explicitly from the moment of receipt; defaulting it
   * here would charge React's scheduling delay to the latency term.
   */
  observe(serverUnixMs: number, receivedAtUnixMs: number): void;
  /** `serverNow - clientNow`, in milliseconds. Zero until the first sample. */
  readonly offsetMs: number;
  /** False until `observe` has been called at least once. */
  readonly calibrated: boolean;
  /** The server's clock at the given client time. */
  now(clientNowMs: number): number;
}

export function createServerClock(windowSize = DEFAULT_SAMPLE_WINDOW): ServerClock {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new RangeError('Server clock window must be a positive integer');
  }

  const samples: number[] = [];
  let offsetMs = 0;
  let calibrated = false;

  return {
    observe(serverUnixMs: number, receivedAtUnixMs: number) {
      if (!Number.isFinite(serverUnixMs) || !Number.isFinite(receivedAtUnixMs)) return;
      samples.push(serverUnixMs - receivedAtUnixMs);
      if (samples.length > windowSize) samples.shift();
      offsetMs = samples.reduce((largest, sample) => Math.max(largest, sample), samples[0]);
      calibrated = true;
    },
    get offsetMs() {
      return offsetMs;
    },
    get calibrated() {
      return calibrated;
    },
    now(clientNowMs: number) {
      return clientNowMs + offsetMs;
    },
  };
}
