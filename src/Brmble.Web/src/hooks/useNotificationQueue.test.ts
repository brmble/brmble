import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useNotificationQueue } from './useNotificationQueue';

/**
 * Regression coverage for the screen-share notification vanishing bug.
 *
 * The App had an effect that cleared the remote screen-share notification on
 * channel switch, but it also depended on the `notifQueue` object returned by
 * this hook. Because the hook returns a NEW object identity whenever an entry
 * is registered/unregistered, registering the screen-share notification itself
 * changed `notifQueue`, re-ran that effect, and immediately cleared the
 * notification it had just shown.
 *
 * This test pins the root-cause property: registering a notification MUST
 * change the hook's returned object identity (documenting the churn), which is
 * exactly why effects must not depend on that identity for channel-change
 * logic. The App-level fix depends only on `currentChannelId`.
 */
describe('useNotificationQueue identity', () => {
  it('returns a new object identity when an entry is registered', () => {
    const { result } = renderHook(() => useNotificationQueue());

    const before = result.current;

    act(() => {
      result.current.register('screen-share', 'info');
    });

    const after = result.current;

    // The identity churn is real: this is why the channel-switch effect must
    // not depend on the queue object.
    expect(after).not.toBe(before);
    expect(after.isVisible('screen-share')).toBe(true);
  });

  it('returns a new object identity when an entry is unregistered', () => {
    const { result } = renderHook(() => useNotificationQueue());

    act(() => {
      result.current.register('screen-share', 'info');
    });
    const before = result.current;

    act(() => {
      result.current.unregister('screen-share');
    });
    const after = result.current;

    expect(after).not.toBe(before);
    expect(after.isVisible('screen-share')).toBe(false);
  });
});

describe('game-outcome replaceable id', () => {
  it('keeps exactly one entry visible across repeated outcome events', () => {
    const { result } = renderHook(() => useNotificationQueue());

    // Simulate the App effect firing four outcome notifications in a row:
    // each new outcome unregisters the prior id before re-registering.
    for (let i = 0; i < 4; i++) {
      act(() => {
        result.current.unregister('game-outcome');
        result.current.register('game-outcome', 'info');
      });

      // Only ever one entry under this id, and it is visible.
      expect(result.current.totalCount).toBe(1);
      expect(result.current.isVisible('game-outcome')).toBe(true);
    }

    // Final unregister clears it entirely.
    act(() => {
      result.current.unregister('game-outcome');
    });
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isVisible('game-outcome')).toBe(false);
  });
});
