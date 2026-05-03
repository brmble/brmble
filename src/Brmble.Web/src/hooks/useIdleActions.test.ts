import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleActions, AFK_THRESHOLD_SEC } from './useIdleActions';
import bridge from '../bridge';

describe('useIdleActions', () => {
  beforeEach(() => {
    vi.spyOn(bridge, 'send').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function render(props: { brmbleIdleSec: number; systemIdleSec: number; isLocked: boolean; inVoiceChannel: boolean }) {
    return renderHook(({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel }) =>
      useIdleActions({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel }),
      { initialProps: props }
    );
  }

  it('does not fire when not in voice', () => {
    render({ brmbleIdleSec: 9999, systemIdleSec: 9999, isLocked: false, inVoiceChannel: false });
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('does not fire when only system is idle (gamer scenario)', () => {
    render({ brmbleIdleSec: 30, systemIdleSec: AFK_THRESHOLD_SEC + 100, isLocked: false, inVoiceChannel: true });
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('does not fire when only Brmble is idle (working in another app)', () => {
    render({ brmbleIdleSec: AFK_THRESHOLD_SEC + 100, systemIdleSec: 30, isLocked: false, inVoiceChannel: true });
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('fires immediately on lock screen, regardless of timers', () => {
    const { result } = render({ brmbleIdleSec: 0, systemIdleSec: 0, isLocked: true, inVoiceChannel: true });
    expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
    expect(result.current.autoLeftAt).not.toBeNull();
  });

  it('fires when both Brmble and system are past threshold', () => {
    const { result } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
    expect(result.current.autoLeftAt).not.toBeNull();
  });

  it('does not re-fire on subsequent ticks while still idle', () => {
    const { rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledTimes(1);

    rerender({
      brmbleIdleSec: AFK_THRESHOLD_SEC + 60,
      systemIdleSec: AFK_THRESHOLD_SEC + 60,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledTimes(1);
  });

  it('re-arms after user returns (brmbleIdle drops to 0)', () => {
    const { rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledTimes(1);

    // User comes back
    rerender({ brmbleIdleSec: 0, systemIdleSec: 0, isLocked: false, inVoiceChannel: true });

    // Goes idle again later
    rerender({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledTimes(2);
  });

  it('dismissToast clears autoLeftAt', () => {
    const { result } = render({ brmbleIdleSec: 0, systemIdleSec: 0, isLocked: true, inVoiceChannel: true });
    expect(result.current.autoLeftAt).not.toBeNull();
    act(() => result.current.dismissToast());
    expect(result.current.autoLeftAt).toBeNull();
  });
});
