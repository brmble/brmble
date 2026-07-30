/**
 * Shared duel text formatting.
 *
 * Every duel surface — panel cards and notifications alike — renders player and
 * duration text through these helpers, so the wording cannot drift between them.
 * New surface: call these. Different copy: change it here, for all of them.
 *
 * Lives beside the duel components rather than in `utils/` deliberately: it is
 * consumed with `useQueuedDuelConfirmation` from this same folder, and its
 * fixtures live in `duelTestHarness.ts` here.
 */

import type { DuelPlayer, DurationEstimate } from '../../api/games';

export function playerName(player: DuelPlayer, resolveName: (sessionId: number) => string): string {
  // resolveName only knows the session id space; a player without a live session
  // (sessionId 0) can't be looked up there, so fall back to the user id.
  return player.displayName.trim()
    || (player.sessionId ? resolveName(player.sessionId) : `Player ${player.userId}`);
}

export function pairLabel(players: DuelPlayer[], resolveName: (sessionId: number) => string): string {
  return players.map(player => playerName(player, resolveName)).join(' vs ');
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m${remainder > 0 ? ` ${remainder}s` : ''}` : `${seconds}s`;
}

/** Rounds a millisecond duration up to a whole second, so a sub-second remainder never renders as `0s`. */
export function ceilToSecondMs(milliseconds: number): number {
  return Math.ceil(milliseconds / 1000) * 1000;
}

/** The usable length of an estimate, or null when the server has none. */
export function estimateMs(estimate: DurationEstimate): number | null {
  return estimate.status === 'known' && estimate.milliseconds != null ? estimate.milliseconds : null;
}

/** The duel's own expected length, as the server measured it. Never a live value. */
export function estimateText(estimate: DurationEstimate): string {
  const milliseconds = estimateMs(estimate);
  return milliseconds != null
    ? `Estimated duration: ~${formatDuration(milliseconds)}`
    : 'Estimated duration: Unknown';
}
