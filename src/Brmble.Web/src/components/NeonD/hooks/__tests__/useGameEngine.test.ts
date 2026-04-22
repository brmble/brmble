import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameEngine } from '../useGameEngine';

describe('useGameEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should update stock and money atomically in one tick', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    const initialMoney = result.current.state.money;
    const initialStock = result.current.state.production.weed.stock;
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.state.production.weed.stock).not.toBe(initialStock);
    expect(result.current.state.money).not.toBe(initialMoney);
  });

  it('should upgrade production item', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.upgrade('weed');
    });
    
    expect(result.current.state.production.weed.level).toBe(2);
  });

  it('should not allow stock to go below zero', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      vi.advanceTimersByTime(100000);
    });
    
    expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
  });
});