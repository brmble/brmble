import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameState } from './useGameState';

vi.useFakeTimers();

describe('useGameState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllTimers();
  });

  describe('income ticker interval', () => {
    it('does not recreate interval when unrelated derived values change', () => {
      const { result } = renderHook(() => useGameState());
      
      act(() => {
        vi.advanceTimersByTime(100);
      });
      
      const initialMoney = result.current.state.money;
      
      act(() => {
        result.current.actions.unlockInfrastructure('home-server');
      });
      
      act(() => {
        result.current.actions.buyInfrastructure('home-server');
      });
      
      act(() => {
        vi.advanceTimersByTime(100);
      });
      
      expect(result.current.state.money).toBe(initialMoney + result.current.state.incomePerSecond / 10);
    });
  });
});
