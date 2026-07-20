import type { IconName } from '../components/Icon/Icon';

/**
 * Per-game presentation metadata for the ephemeral minigame spectator feed.
 *
 * Each entry maps a server `gameType` string to its display name (shown as the
 * feed message sender) and its avatar icon (rendered by <Avatar> for feed lines).
 *
 * To add a new game (e.g. Rock Paper Scissors):
 *   1. Add its icon to Icon.tsx under the GAMES category (e.g. 'game-rps').
 *   2. Add an entry here: `rps: { name: 'Rock Paper Scissors', icon: 'game-rps' }`.
 * No other wiring is required — the feed avatar and label update automatically.
 */
export interface GameMeta {
  name: string;
  icon: IconName;
}

const GAME_META: Record<string, GameMeta> = {
  deathroll: { name: 'Deathroll', icon: 'game-deathroll' },
};

/** Fallback avatar icon for an unknown/future game type. */
export const DEFAULT_GAME_ICON: IconName = 'game-deathroll';

/** Display name for a game feed message sender. Falls back to a capitalized gameType, or 'Game'. */
export function gameDisplayName(gameType?: string): string {
  if (!gameType) return 'Game';
  const meta = GAME_META[gameType];
  if (meta) return meta.name;
  return gameType.charAt(0).toUpperCase() + gameType.slice(1);
}

/** Avatar icon name for a game feed message. Falls back to the default game icon. */
export function gameAvatarIcon(gameType?: string): IconName {
  if (!gameType) return DEFAULT_GAME_ICON;
  return GAME_META[gameType]?.icon ?? DEFAULT_GAME_ICON;
}
