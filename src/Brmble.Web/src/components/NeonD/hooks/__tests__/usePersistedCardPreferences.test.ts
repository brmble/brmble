import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NEON_D_CARD_PREFERENCES_KEY,
  usePersistedCardPreferences,
} from '../usePersistedCardPreferences';

describe('usePersistedCardPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists and restores collapsed seller ids immediately', () => {
    const first = renderHook(() => usePersistedCardPreferences(['dealer-1']));

    act(() => first.result.current[1]('dealer-1'));

    expect(JSON.parse(localStorage.getItem(NEON_D_CARD_PREFERENCES_KEY)!)).toEqual({
      collapsedSellerIds: ['dealer-1'],
    });

    first.unmount();

    const second = renderHook(() => usePersistedCardPreferences(['dealer-1']));
    expect(second.result.current[0]).toEqual(new Set(['dealer-1']));

    act(() => second.result.current[1]('dealer-1'));

    expect(JSON.parse(localStorage.getItem(NEON_D_CARD_PREFERENCES_KEY)!)).toEqual({
      collapsedSellerIds: [],
    });
  });

  it('ignores stored seller ids that are no longer known', () => {
    localStorage.setItem(
      NEON_D_CARD_PREFERENCES_KEY,
      JSON.stringify({ collapsedSellerIds: ['old-seller'] }),
    );

    const { result } = renderHook(() => usePersistedCardPreferences(['current-seller']));

    expect(result.current[0]).toEqual(new Set());
  });
});
