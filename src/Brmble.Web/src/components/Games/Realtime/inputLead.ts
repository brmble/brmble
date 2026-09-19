/**
 * How far ahead of the server's clock this client stamps its inputs.
 *
 * The server applies an input at the tick the client stamped it with, so an input
 * has to *arrive* before that tick or it is applied late, on arrival, and the
 * client's prediction of it is wrong by however late it was. The client therefore
 * stamps `estimated server tick + lead`, where the lead covers the round trip the
 * client can measure plus a small margin for jitter, and predicts locally from the
 * same stamped tick. When the lead is right, movement starts on the client the
 * frame the key goes down, the server starts it on exactly the tick the client
 * assumed, and the next snapshot agrees with the prediction - no correction.
 *
 * RTT is measured with no wire change: every snapshot echoes the newest input
 * sequence the server has received, and the client knows when it sent that
 * sequence. The sample includes up to one snapshot interval (50 ms) of quantisation
 * on the server side, which acts as a free margin. A bounded window and a low
 * percentile follow the same discipline as `serverClock`: the fastest samples are
 * the truest, and the window keeps the estimate tracking a changing network.
 *
 * Changes to the lead move the local clock, and a moved clock is a correction on
 * screen, so the lead is slewed one tick at a time no faster than `slewMs` - except
 * for the very first sample, which is taken at once: before it the lead is a guess,
 * and slewing up from the guess would spend the opening seconds of every match
 * applying inputs late.
 *
 * It must be measured from the *received* acknowledgement, never from when the
 * server installed the input: an install-time acknowledgement would fold the
 * client's own lead into its RTT estimate and the lead would run away.
 */
export interface InputLeadOptions {
  tickRate: number;
  /** Samples kept. 40 is 2 s at the 20 Hz snapshot rate. */
  windowSize?: number;
  /** Ticks added on top of the measured round trip. */
  marginTicks?: number;
  minTicks?: number;
  maxTicks?: number;
  /** Minimum time between one-tick changes of the lead. */
  slewMs?: number;
  /** Fraction of the window the estimate is taken at; 0.2 is the 20th percentile. */
  percentile?: number;
}

export interface InputLead {
  /** Record one round-trip sample in milliseconds, taken at client time `nowMs`. */
  sample(rttMs: number, nowMs: number): void;
  /** The lead to stamp with right now, in ticks. Slews towards the target over time. */
  leadTicks(nowMs: number): number;
  /** The lead the samples currently justify, before slewing. */
  readonly targetTicks: number;
  /** The round-trip estimate in milliseconds, or null before the first sample. */
  readonly rttMs: number | null;
  readonly sampleCount: number;
}

export const DEFAULT_LEAD_WINDOW = 40;
export const DEFAULT_LEAD_MARGIN_TICKS = 2;
export const DEFAULT_LEAD_MIN_TICKS = 3;
export const DEFAULT_LEAD_MAX_TICKS = 20;
export const DEFAULT_LEAD_SLEW_MS = 500;

export function createInputLead({
  tickRate,
  windowSize = DEFAULT_LEAD_WINDOW,
  marginTicks = DEFAULT_LEAD_MARGIN_TICKS,
  minTicks = DEFAULT_LEAD_MIN_TICKS,
  maxTicks = DEFAULT_LEAD_MAX_TICKS,
  slewMs = DEFAULT_LEAD_SLEW_MS,
  percentile = 0.2,
}: InputLeadOptions): InputLead {
  if (!Number.isFinite(tickRate) || tickRate <= 0) throw new RangeError('Input lead needs a positive tick rate');
  if (!Number.isInteger(windowSize) || windowSize < 1) throw new RangeError('Input lead window must be a positive integer');
  if (minTicks > maxTicks) throw new RangeError('Input lead minimum exceeds its maximum');

  const samples: number[] = [];
  let rttMs: number | null = null;
  let targetTicks = minTicks;
  let currentTicks = minTicks;
  let lastSlewAt = Number.NEGATIVE_INFINITY;

  const clamp = (ticks: number) => Math.min(maxTicks, Math.max(minTicks, ticks));

  return {
    sample(rtt, nowMs) {
      if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(nowMs)) return;
      samples.push(rtt);
      if (samples.length > windowSize) samples.shift();
      const sorted = [...samples].sort((left, right) => left - right);
      const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
      rttMs = sorted[index];
      targetTicks = clamp(Math.ceil(rttMs * tickRate / 1000) + marginTicks);
      if (samples.length === 1) {
        currentTicks = targetTicks;
        lastSlewAt = nowMs;
      }
    },
    leadTicks(nowMs) {
      if (currentTicks !== targetTicks && nowMs - lastSlewAt >= slewMs) {
        currentTicks += currentTicks < targetTicks ? 1 : -1;
        lastSlewAt = nowMs;
      }
      return currentTicks;
    },
    get targetTicks() {
      return targetTicks;
    },
    get rttMs() {
      return rttMs;
    },
    get sampleCount() {
      return samples.length;
    },
  };
}
