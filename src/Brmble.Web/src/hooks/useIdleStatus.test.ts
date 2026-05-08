import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleStatus } from './useIdleStatus';
import bridge from '../bridge';

function dispatch(data: unknown) {
  const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
  const list = handlers.get('voice.idleUpdate') ?? [];
  list.forEach(h => h(data));
}

describe('useIdleStatus', () => {
  it('starts with empty defaults', () => {
    const { result } = renderHook(() => useIdleStatus());
    expect(result.current.voiceIdle).toEqual({});
    expect(result.current.systemIdle).toBe(0);
    expect(result.current.isLocked).toBe(false);
  });

  it('updates state on voice.idleUpdate', () => {
    const { result } = renderHook(() => useIdleStatus());
    act(() => {
      dispatch({ voiceIdle: { 5: 700, 7: 30 }, systemIdle: 120, isLocked: false });
    });
    expect(result.current.voiceIdle).toEqual({ 5: 700, 7: 30 });
    expect(result.current.systemIdle).toBe(120);
    expect(result.current.isLocked).toBe(false);
  });

  it('handles isLocked transitions', () => {
    const { result } = renderHook(() => useIdleStatus());
    act(() => { dispatch({ voiceIdle: {}, systemIdle: 0, isLocked: true }); });
    expect(result.current.isLocked).toBe(true);

    act(() => { dispatch({ voiceIdle: {}, systemIdle: 5, isLocked: false }); });
    expect(result.current.isLocked).toBe(false);
  });

  it('falls back to defaults on partial payload', () => {
    const { result } = renderHook(() => useIdleStatus());
    act(() => { dispatch({}); });
    expect(result.current.voiceIdle).toEqual({});
    expect(result.current.systemIdle).toBe(0);
    expect(result.current.isLocked).toBe(false);
  });

  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => useIdleStatus());
    const handlers = (bridge as unknown as { _handlers: Map<string, Array<(d: unknown) => void>> })._handlers;
    const before = handlers.get('voice.idleUpdate')?.length ?? 0;
    unmount();
    const after = handlers.get('voice.idleUpdate')?.length ?? 0;
    expect(after).toBe(before - 1);
  });
});
