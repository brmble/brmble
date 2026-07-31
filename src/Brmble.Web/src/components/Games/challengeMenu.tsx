import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import { Icon } from '../Icon/Icon';

/** The item member of the ContextMenuItem union — what this helper always returns. */
export type ChallengeMenuItem = Extract<ContextMenuItem, { type: 'item' }>;

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
 *
 * A player may only be queued or in one live game at a time, so the server refuses the
 * challenge outright if either side already holds a duel commitment. When `busy` says
 * so, the entry is rendered disabled and its label states the reason instead of offering
 * a challenge that must fail. Being in a duel yourself blocks every challenge, so that
 * copy takes precedence over the target's.
 */
export function buildChallengeMenuItem(
  session: number,
  onChallengeDeathroll: (session: number) => void,
  onChallengeRps: (session: number, bestOf: number) => void,
  busy?: {
    /** Sessions the server currently holds a duel commitment for. */
    committedSessions?: ReadonlySet<number>;
    /** The local player's session, so their own commitment can be named. */
    selfSession?: number;
    /** Display name of the challenged user, for the "<name> is in a duel" copy. */
    targetName?: string;
  },
): ChallengeMenuItem {
  const rpsBestOf = (n: number): ContextMenuItem => ({
    type: 'item',
    label: `Best of ${n}`,
    onClick: () => onChallengeRps(session, n),
  });

  const committed = busy?.committedSessions;
  const selfBusy = busy?.selfSession != null && !!committed?.has(busy.selfSession);
  const targetBusy = !!committed?.has(session);
  if (selfBusy || targetBusy) {
    return {
      type: 'item',
      label: selfBusy ? "You're in a duel" : `${busy?.targetName ?? 'That player'} is in a duel`,
      icon: <Icon name="swords" size={14} />,
      disabled: true,
      // No children: a disabled parent must not be able to open an empty flyout.
    };
  }

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
