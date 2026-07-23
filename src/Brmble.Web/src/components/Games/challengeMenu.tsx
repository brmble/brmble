import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import { Icon } from '../Icon/Icon';

/**
 * Builds the "Challenge to a duel" context-menu entry shown on eligible user rows.
 *
 * The entry is a submenu of game types:
 *   - Deathroll — challenges immediately (no rounds/best-of).
 *   - Rock Paper Scissors — a further submenu of "Best of N" rounds, each of which
 *     invites with the chosen best-of length.
 *
 * Eligibility (same channel, Brmble client, not self) is decided by the caller; this
 * helper only assembles the menu item.
 */
export function buildChallengeMenuItem(
  session: number,
  onChallengeDeathroll: (session: number) => void,
  onChallengeRps: (session: number, bestOf: number) => void,
): ContextMenuItem {
  const rpsBestOf = (n: number): ContextMenuItem => ({
    type: 'item',
    label: `Best of ${n}`,
    onClick: () => onChallengeRps(session, n),
  });

  return {
    type: 'item',
    label: 'Challenge to a duel',
    icon: <Icon name="swords" size={14} />,
    children: [
      {
        type: 'item',
        label: 'Deathroll',
        icon: <Icon name="game-deathroll" size={14} />,
        onClick: () => onChallengeDeathroll(session),
      },
      {
        type: 'item',
        label: 'Rock Paper Scissors',
        icon: <Icon name="game-rps" size={14} />,
        children: [rpsBestOf(3), rpsBestOf(5), rpsBestOf(7)],
      },
    ],
  };
}
