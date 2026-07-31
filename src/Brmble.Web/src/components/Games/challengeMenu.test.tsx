import { describe, it, expect, vi } from 'vitest';
import { buildChallengeMenuItem } from './challengeMenu';

const noop = () => {};

function item(busy?: Parameters<typeof buildChallengeMenuItem>[3]) {
  return buildChallengeMenuItem(22, noop, noop, busy);
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
  it('disables and names the target when the target is committed', () => {
    const built = item({ committedSessions: new Set([22]), selfSession: 11, targetName: 'Ava' });

    expect(built.disabled).toBe(true);
    expect(built.label).toBe('Ava is in a duel');
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

  it('still invites when enabled', () => {
    const onDeathroll = vi.fn();
    const built = buildChallengeMenuItem(22, onDeathroll, noop);
    const deathroll = built.children?.[0];

    if (deathroll?.type !== 'item') throw new Error('expected a deathroll item');
    deathroll.onClick?.();

    expect(onDeathroll).toHaveBeenCalledWith(22);
  });
});
