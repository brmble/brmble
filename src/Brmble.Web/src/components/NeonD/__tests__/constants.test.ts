import { INITIAL_GAME_STATE } from '../constants';

describe('Constants', () => {
  it('should use English display names', () => {
    expect(INITIAL_GAME_STATE.production.weed.name).toBe('Weed');
  });
});