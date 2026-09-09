import { describe, expect, it } from 'vitest';
import { applyChangeSet } from './useUserDirectory';
import type { User } from '../types';

const row = (session: number, over: Partial<User> = {}): User =>
  ({ session, name: `u${session}`, companionId: null, isBrmbleClient: null, ...over }) as User;

describe('applyChangeSet', () => {
  it('replaces a row wholesale rather than merging fields', () => {
    const before = [row(1, { companionId: 'retro', isBrmbleClient: true })];

    const after = applyChangeSet(before, { changed: [row(1, { companionId: null })], removed: [] });

    expect(after[0].companionId).toBeNull();
    expect(after[0].isBrmbleClient).toBeNull();
  });

  it('appends an unknown session', () => {
    expect(applyChangeSet([], { changed: [row(2)], removed: [] })).toHaveLength(1);
  });

  it('removes by session id', () => {
    expect(applyChangeSet([row(1), row(2)], { changed: [], removed: [1] }))
      .toEqual([row(2)]);
  });

  it('preserves the order of untouched rows', () => {
    const after = applyChangeSet([row(1), row(2), row(3)], { changed: [row(2, { name: 'x' })], removed: [] });
    expect(after.map(u => u.session)).toEqual([1, 2, 3]);
  });

  it('returns the same array reference when nothing changed', () => {
    // Identity matters: this feeds a useState setter, and a new array every time would
    // re-render every consumer on every no-op event.
    const before = [row(1)];
    expect(applyChangeSet(before, { changed: [], removed: [] })).toBe(before);
  });

  it('applies a removal and an addition in one change set', () => {
    const after = applyChangeSet([row(1), row(2)], { changed: [row(3)], removed: [1] });
    expect(after.map(u => u.session)).toEqual([2, 3]);
  });
});
