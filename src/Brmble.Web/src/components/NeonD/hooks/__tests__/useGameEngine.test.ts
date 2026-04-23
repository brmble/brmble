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

  it('should update production without dealer', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
    });
    
    const initialStock = result.current.state.production.weed.stock;
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.state.production.weed.stock).toBeGreaterThan(initialStock);
  });
  
  it('should earn money when dealer sells', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
      result.current.hireDealer({ id: 'test-dealer', name: 'Test', selling: 'weed', volume: 10, margin: 1, volumeBonus: 1.0, marginBonus: 1.0, sideHustle: {}, equipmentCount: 0 }, 0);
    });
    
    const initialMoney = result.current.state.money;
    
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    
    expect(result.current.state.money).toBeGreaterThan(initialMoney);
  });

  it('should upgrade production item', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
    });
    
    expect(result.current.state.production.weed.level).toBe(1);
  });

  it('should not allow stock to go below zero', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      vi.advanceTimersByTime(100000);
    });
    
    expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
  });
});