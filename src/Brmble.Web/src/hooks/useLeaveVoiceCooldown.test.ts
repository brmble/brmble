import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLeaveVoiceCooldown } from './useLeaveVoiceCooldown';

describe('useLeaveVoiceCooldown', () => {
  it('should start with cooldown disabled', () => {
    const { result } = renderHook(() => useLeaveVoiceCooldown());
    expect(result.current.isOnCooldown).toBe(false);
  });

  it('should enable cooldown when trigger is called', () => {
    const { result } = renderHook(() => useLeaveVoiceCooldown());
    
    act(() => {
      result.current.trigger();
    });
    
    expect(result.current.isOnCooldown).toBe(true);
  });

  it('should disable cooldown after 1 second', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLeaveVoiceCooldown());
    
    act(() => {
      result.current.trigger();
    });
    
    expect(result.current.isOnCooldown).toBe(true);
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.isOnCooldown).toBe(false);
    vi.useRealTimers();
  });
});