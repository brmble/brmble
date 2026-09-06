import type { ArenaStateSnapshot } from './arenaProtocol';

export const KNOCKOUT_DURATION_MS = 1400;
export const SLIDE_END = 0.3;
export const FALL_END = 0.7;

/** Minimum outward travel, in body diameters. */
const CLEARANCE_DIAMETERS = 1;
/** How far one unit of per-tick velocity carries the body, in world units. */
const VELOCITY_TRAVEL = 12;
/** Dust ring size at full expansion, in body diameters. */
const PUFF_DIAMETERS = 1.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export interface ArenaKnockoutVictim {
  sessionId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ArenaKnockout {
  victims: ArenaKnockoutVictim[];
  startedAt: number;
  /** Forfeit and abandon vanish in place with no slide or fall. */
  vanishOnly: boolean;
}

export interface ArenaKnockoutFrame {
  sessionId: number;
  x: number;
  y: number;
  /** Body scale, 1 at the lip down to 0 when fallen. */
  scale: number;
  /** Dust ring radius in world units; 0 before the puff. */
  puffRadius: number;
  /** Dust ring opacity, 0 outside the puff window. */
  puffOpacity: number;
}

/**
 * Pure function of elapsed time. Presentation only: the result is never written
 * back into prediction, presentation or authority state.
 */
export function sampleKnockout(
  knockout: ArenaKnockout,
  nowMs: number,
  playerRadius: number,
  reducedMotion: boolean,
): ArenaKnockoutFrame[] {
  const progress = clamp01((nowMs - knockout.startedAt) / KNOCKOUT_DURATION_MS);
  const diameter = playerRadius * 2;

  return knockout.victims.map(victim => {
    // The puff is normally held back until the body has finished falling so the
    // dust does not overlap it. When there is no fall to overlap, the puff is
    // the whole animation and must start at once, or nothing at all is drawn
    // for the first 70% of the knockout.
    const immediate = reducedMotion || knockout.vanishOnly;
    const puffProgress = immediate
      ? progress
      : progress <= FALL_END ? 0 : (progress - FALL_END) / (1 - FALL_END);
    // Reduced motion gets a static full-size mark that only fades; an expanding
    // ring is itself a scaling animation, which is what the setting guards
    // against. A forfeit is not reduced motion, so it keeps the expansion.
    const puffRadius = reducedMotion
      ? diameter * PUFF_DIAMETERS
      : puffProgress === 0 ? 0 : diameter * PUFF_DIAMETERS * easeOut(puffProgress);
    // `puffProgress === 0` means "not begun" on the gated path but "at its
    // start" on the immediate path, where opacity must already be full. Sharing
    // the sentinel would blank the first frame and then pop to ~0.99 on the next.
    const puffOpacity = immediate
      ? 1 - puffProgress
      : puffProgress === 0 ? 0 : 1 - puffProgress;

    // Reduced motion keeps the information — where the player left — and drops
    // the movement and scaling that the setting exists to prevent.
    if (immediate) {
      return {
        sessionId: victim.sessionId,
        x: victim.x,
        y: victim.y,
        scale: (reducedMotion || progress > 0) ? 0 : 1,
        puffRadius, puffOpacity,
      };
    }

    // The exit normal points outward from the arena centre. Coincident with the
    // centre is impossible for a knockout, but guard rather than divide by zero.
    const distance = Math.hypot(victim.x, victim.y) || 1;
    const normalX = victim.x / distance;
    const normalY = victim.y / distance;
    const speed = Math.hypot(victim.vx, victim.vy);
    const travel = diameter * CLEARANCE_DIAMETERS + speed * VELOCITY_TRAVEL;

    const slide = easeOut(clamp01(progress / SLIDE_END)) * travel;
    const fallProgress = progress <= SLIDE_END
      ? 0
      : clamp01((progress - SLIDE_END) / (FALL_END - SLIDE_END));
    const drift = fallProgress * diameter;

    return {
      sessionId: victim.sessionId,
      x: Math.round(victim.x + normalX * (slide + drift)),
      y: Math.round(victim.y + normalY * (slide + drift)),
      scale: 1 - fallProgress,
      puffRadius, puffOpacity,
    };
  });
}

const toVictim = (player: ArenaStateSnapshot['players'][number]): ArenaKnockoutVictim => ({
  sessionId: player.sessionId, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
});

/**
 * A knockout is inferred, not reported: the server resets the round in the same
 * tick it detects the boundary crossing, so the out-of-bounds position never
 * reaches the wire. The score names the winner, so the other side is the victim,
 * and the previous snapshot still holds where they were and how fast.
 */
export function detectKnockout(
  previous: ArenaStateSnapshot | null,
  next: ArenaStateSnapshot,
  startedAt: number,
): ArenaKnockout | null {
  if (previous === null || previous.phase !== 'live') return null;
  if (next.phase !== 'loading' && next.phase !== 'ended') return null;

  const scored = next.score.findIndex((value, side) => value > previous.score[side]);
  const doubled = next.consecutiveDoubleKos > previous.consecutiveDoubleKos;
  if (scored === -1 && !doubled) return null;

  // `doubled ||` is defensive and unreachable by design: a double knockout
  // scores nothing, so `scored` is -1 and no player matches `side === -1`
  // anyway. It states the intent rather than leaning on that coincidence.
  const victims = previous.players
    .filter(player => doubled || player.side !== scored)
    .map(toVictim);
  // Defensive, and untested because it is unreachable with the two-player
  // arena: one side always loses, so the filter never empties.
  return victims.length === 0 ? null : { victims, startedAt, vanishOnly: false };
}

/** Forfeit and abandon: the player disappears where they stand. */
export function vanishInPlace(
  state: ArenaStateSnapshot,
  sessionIds: readonly number[],
  startedAt: number,
): ArenaKnockout | null {
  const victims = state.players
    .filter(player => sessionIds.includes(player.sessionId))
    .map(toVictim);
  return victims.length === 0 ? null : { victims, startedAt, vanishOnly: true };
}
