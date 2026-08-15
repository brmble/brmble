import { renderHook, act } from '@testing-library/react';
import { usePersistedGameState } from '../usePersistedGameState';
import { createBaseGameState } from '../../constants';
import { migrateNeonDState } from '../../saveFormat';
import type { GameState } from '../../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('usePersistedGameState', () => {
  const initial = { a: 1, nested: { b: 2, c: 3 } };

  it('removes the retired recruitment fund from migrated saves', () => {
    const previousState = {
      ...createBaseGameState(0),
      captainRecruitmentFund: 1_250_000,
    } as GameState & { captainRecruitmentFund: number };

    const migrated = migrateNeonDState(previousState) as GameState;
    expect(migrated).not.toHaveProperty('captainRecruitmentFund');
  });

  it('loads initial state when local storage is empty', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual(initial);
  });

  it('deep merges stored state with initial state (soft versioning)', () => {
    localStorage.setItem('test_key', JSON.stringify({ a: 10, nested: { b: 20 } })); // 'c' is missing
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual({ a: 10, nested: { b: 20, c: 3 } });
  });

  it('migrates an actual v2 Neon-D state before merging it into the initial state', () => {
    const v2State = {
      ...createBaseGameState(0),
      schemaVersion: 2,
      bulkUnlocked: true,
      autoBulkEnabled: true,
    } as unknown as GameState & {
      bulkUnlocked: boolean;
      autoBulkEnabled: boolean;
    };
    delete (v2State as Partial<GameState>).bulkUnlockedProductIds;
    delete (v2State as Partial<GameState>).lastBulkSellAt;
    localStorage.setItem('neon_d_key', JSON.stringify(v2State));

    const initial = createBaseGameState(1);
    const { result, unmount } = renderHook(() => usePersistedGameState<GameState>(
      'neon_d_key',
      initial,
      migrateNeonDState,
    ));

    expect(result.current[0].schemaVersion).toBe(5);
    expect(result.current[0].bulkUnlockedProductIds).toEqual([]);
    expect(result.current[0]).not.toHaveProperty('bulkUnlocked');
    expect(result.current[0]).not.toHaveProperty('autoBulkEnabled');

    unmount();
    const persisted = JSON.parse(localStorage.getItem('neon_d_key') ?? '{}');
    expect(persisted.schemaVersion).toBe(5);
    expect(persisted.bulkUnlockedProductIds).toEqual([]);
    expect(persisted).not.toHaveProperty('bulkUnlocked');
    expect(persisted).not.toHaveProperty('autoBulkEnabled');
  });

  it('falls back to initial state if JSON parsing fails', () => {
    localStorage.setItem('test_key', 'invalid json');
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual(initial);
  });

  it('saves to localStorage after 30 seconds interval', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 99, nested: { b: 2, c: 3 } });
    });
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 99, nested: { b: 2, c: 3 } });
  });

  it('saves to localStorage on beforeunload', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 55, nested: { b: 2, c: 3 } });
    });
    window.dispatchEvent(new Event('beforeunload'));
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 55, nested: { b: 2, c: 3 } });
  });

  it('saves to localStorage when document becomes hidden', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 77, nested: { b: 2, c: 3 } });
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    document.dispatchEvent(new Event('visibilitychange'));
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 77, nested: { b: 2, c: 3 } });
  });

  it('saves to localStorage on unmount', () => {
    const { result, unmount } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 88, nested: { b: 2, c: 3 } });
    });

    unmount();
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 88, nested: { b: 2, c: 3 } });
  });

  it('clears localStorage when clear function is called', () => {
    localStorage.setItem('test_key', JSON.stringify({ a: 99, nested: { b: 99, c: 99 } }));
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[2](); // call clear
    });
    expect(localStorage.getItem('test_key')).toBeNull();
  });
});
