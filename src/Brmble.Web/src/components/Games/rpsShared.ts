import type { IconName } from '../Icon/Icon';

/**
 * Seconds of anticipation before a resolved round is revealed.
 *
 * Shared deliberately: the participant board and the spectator board must run the
 * same beat, so a watcher sitting beside a player sees the result at the same moment.
 * Two copies could drift and nothing would catch it — import this, never redeclare it.
 */
export const REVEAL_SECONDS = 3;

export interface RpsPick {
  id: string;
  label: string;
  icon: IconName;
}

/** The three throws, in board order (matches the server engine). */
export const PICKS: RpsPick[] = [
  { id: 'rock', label: 'Rock', icon: 'rps-rock' },
  { id: 'paper', label: 'Paper', icon: 'rps-paper' },
  { id: 'scissors', label: 'Scissors', icon: 'rps-scissors' },
];

/**
 * Icon for a throw, or null when there is nothing to show. `none` is a real wire
 * value — the engine emits it for a player who never threw (idle timeout or
 * forfeit) — and it deliberately has no icon rather than a fabricated one.
 */
export function pickIcon(pick: string): IconName | null {
  return PICKS.find(p => p.id === pick)?.icon ?? null;
}

/** Human label for a throw. `none` reads as "No throw". */
export function pickLabel(pick: string): string {
  return PICKS.find(p => p.id === pick)?.label ?? 'No throw';
}
