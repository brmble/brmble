import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBrmbleIdle } from './useBrmbleIdle';
import bridge from '../bridge';

describe('useBrmbleIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 idle seconds', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    expect(result.current).toBe(0);
  });

  it('climbs by one each second when no activity', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(3);
  });

  it('resets to 0 on a DOM input event', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(5);

    act(() => {
      window.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);
  });

  it('resets on voice.localTransmit bridge ping', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(7000); });
    expect(result.current).toBe(7);

    act(() => {
      // Simulate the bridge dispatching the message
      const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
      const list = handlers.get('voice.localTransmit') ?? [];
      list.forEach(h => h({}));
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderHook(() => useBrmbleIdle());
    const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
    expect(handlers.get('voice.localTransmit')?.length ?? 0).toBeGreaterThan(0);

    unmount();
    expect(handlers.get('voice.localTransmit')?.length ?? 0).toBe(0);
  });
});
