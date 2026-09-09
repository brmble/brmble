import { describe, expect, it } from 'vitest';
import { selectStage, type ChannelActivityKind } from './channelActivity';

describe('selectStage', () => {
  it('returns nothing when the channel is quiet', () => {
    expect(selectStage({ available: [], explicit: null, previous: null })).toBeNull();
  });

  it('stages the first activity to appear', () => {
    expect(selectStage({ available: ['screen-share'], explicit: null, previous: null })).toBe('screen-share');
  });

  it('does not let a later activity steal the stage', () => {
    expect(selectStage({ available: ['screen-share', 'paint'], explicit: null, previous: 'screen-share' })).toBe('screen-share');
  });

  it('keeps the staged activity even when it is not first in the list', () => {
    expect(selectStage({ available: ['screen-share', 'paint'], explicit: null, previous: 'paint' })).toBe('paint');
  });

  it('honours an explicit choice', () => {
    expect(selectStage({ available: ['screen-share', 'paint'], explicit: 'paint', previous: 'screen-share' })).toBe('paint');
  });

  it('ignores an explicit choice that is no longer available', () => {
    expect(selectStage({ available: ['screen-share'], explicit: 'paint', previous: null })).toBe('screen-share');
  });

  it('hands over when the staged activity ends', () => {
    expect(selectStage({ available: ['paint'], explicit: null, previous: 'screen-share' })).toBe('paint');
  });

  it('returns nothing when the last activity ends', () => {
    expect(selectStage({ available: [], explicit: 'paint', previous: 'paint' })).toBeNull();
  });

  it('stages spectate when it is the only activity', () => {
    expect(selectStage({ available: ['spectate'], explicit: null, previous: null })).toBe('spectate');
  });

  it('does not let spectate steal the stage from a live activity', () => {
    // 'spectate' is deliberately first: the fallback branch would return it, so only
    // the `previous` branch can yield 'paint'. Ordering it second would pass even
    // with `previous` removed.
    expect(selectStage({ available: ['spectate', 'paint'], explicit: null, previous: 'paint' })).toBe('paint');
  });

  it('honours an explicit click on spectate', () => {
    expect(selectStage({ available: ['screen-share', 'paint', 'spectate'], explicit: 'spectate', previous: 'paint' }))
      .toBe('spectate');
  });

  it('hands the stage over when spectating stops', () => {
    expect(selectStage({ available: ['paint'], explicit: 'spectate', previous: 'spectate' })).toBe('paint');
  });
});

describe('ChannelActivityKind', () => {
  it('has exactly three members', () => {
    // A total Record keyed by the union, not a `ChannelActivityKind[]` literal: adding
    // a fourth member WIDENS an array's element type, so a three-element array stays
    // assignable and nothing signals. A total Record fails to compile instead (TS2739),
    // the same mechanism that makes ACTIVITY_LABELS load-bearing.
    const ALL: Record<ChannelActivityKind, true> = { 'screen-share': true, paint: true, spectate: true };
    expect(Object.keys(ALL)).toHaveLength(3);
  });
});
