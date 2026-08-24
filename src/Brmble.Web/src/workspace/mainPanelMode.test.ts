import { describe, expect, it } from 'vitest';
import { selectMainPanelMode } from './mainPanelMode';

describe('selectMainPanelMode', () => {
  it('splits when nothing is being played', () => {
    expect(selectMainPanelMode({ idleGameOpen: false, participatingMatchId: null })).toBe('split');
  });

  it('takes the panel for the idle game', () => {
    expect(selectMainPanelMode({ idleGameOpen: true, participatingMatchId: null })).toBe('game');
  });

  it('takes the panel while participating in a match', () => {
    expect(selectMainPanelMode({ idleGameOpen: false, participatingMatchId: 'match-1' })).toBe('game');
  });

  it('prefers the match when both are somehow set', () => {
    expect(selectMainPanelMode({ idleGameOpen: true, participatingMatchId: 'match-1' })).toBe('game');
  });
});
