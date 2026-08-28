import { describe, it, expect, vi } from 'vitest';
import { buildChallengeMenuItem } from './challengeMenu';
import type { ChallengeMenuItem } from './challengeMenu';

const noop = () => {};

type BusyState = {
  committedSessions?: ReadonlySet<number>;
  selfSession?: number;
  targetName?: string;
};

function findChild(item: ChallengeMenuItem, label: string): ChallengeMenuItem {
  const child = item.children?.find(candidate => candidate.type === 'item' && candidate.label === label);
  if (child?.type !== 'item') throw new Error(`expected a ${label} item`);
  return child;
}

function item(busy?: BusyState) {
  return buildChallengeMenuItem(22, noop, busy);
}

describe('buildChallengeMenuItem', () => {
  it('is enabled with its game-type submenu when neither player is committed', () => {
    const built = item({ committedSessions: new Set([99]), selfSession: 11, targetName: 'Ava' });

    expect(built.label).toBe('Challenge to a duel');
    expect(built.disabled).toBeFalsy();
    expect(built.children).toHaveLength(2);
  });

  it('is enabled when no busy information is supplied at all', () => {
    const built = item();

    expect(built.label).toBe('Challenge to a duel');
    expect(built.disabled).toBeFalsy();
    expect(built.children).toHaveLength(2);
  });

  // The server rejects the challenge if EITHER side already holds a commitment, so
  // the entry must state which side is the blocker rather than silently failing.
  it('renders one disabled entry with no children when either side is committed', () => {
    const built = buildChallengeMenuItem(7, vi.fn(), {
      committedSessions: new Set([7]), selfSession: 1, targetName: 'Ada',
    });

    expect(built.disabled).toBe(true);
    expect(built.label).toBe('Ada is in a duel');
    expect(built.children).toBeUndefined();
  });

  it('disables with the self-blocked copy when the local player is committed', () => {
    const built = item({ committedSessions: new Set([11]), selfSession: 11, targetName: 'Ava' });

    expect(built.disabled).toBe(true);
    expect(built.label).toBe("You're in a duel");
    expect(built.children).toBeUndefined();
  });

  // Being in a duel yourself blocks every challenge, so it outranks the target's state.
  it('prefers the self copy when both players are committed', () => {
    const built = item({ committedSessions: new Set([11, 22]), selfSession: 11, targetName: 'Ava' });

    expect(built.label).toBe("You're in a duel");
  });

  it('invites with the chosen game type and options through one handler', () => {
    const onChallenge = vi.fn();
    const built = buildChallengeMenuItem(7, onChallenge);

    const deathroll = findChild(built, 'Deathroll');
    deathroll.onClick?.();
    expect(onChallenge).toHaveBeenNthCalledWith(1, 7, 'deathroll', undefined);

    const rps = findChild(built, 'Rock Paper Scissors');
    findChild(rps, 'Best of 5').onClick?.();
    expect(onChallenge).toHaveBeenNthCalledWith(2, 7, 'rps', { bestOf: 5 });
  });
});
