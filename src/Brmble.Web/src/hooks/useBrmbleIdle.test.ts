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

  it('updates every tick (5s) and reflects elapsed seconds', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(5);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(10);
  });

  it('resets to 0 on a DOM input event (visible after next tick)', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe(10);

    act(() => {
      window.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(5);
  });

  it('resets on voice.localTransmit bridge ping', () => {
    const { result } = renderHook(() => useBrmbleIdle());
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe(10);

    act(() => {
      const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
      const list = handlers.get('voice.localTransmit') ?? [];
      list.forEach(h => h({}));
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(5);
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderHook(() => useBrmbleIdle());
    const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
    expect(handlers.get('voice.localTransmit')?.length ?? 0).toBeGreaterThan(0);

    unmount();
    expect(handlers.get('voice.localTransmit')?.length ?? 0).toBe(0);
  });
});
