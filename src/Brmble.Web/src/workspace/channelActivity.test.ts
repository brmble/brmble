import { describe, expect, it } from 'vitest';
import { selectStage } from './channelActivity';

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
});
