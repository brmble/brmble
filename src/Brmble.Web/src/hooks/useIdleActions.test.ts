import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleActions, AFK_THRESHOLD_SEC, PRE_LEAVE_WARNING_SEC } from './useIdleActions';
import bridge from '../bridge';

describe('useIdleActions', () => {
  beforeEach(() => {
    vi.spyOn(bridge, 'send').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function render(props: {
    brmbleIdleSec: number;
    systemIdleSec: number;
    isLocked: boolean;
    inVoiceChannel: boolean;
    onBeforeAutoLeave?: () => void | Promise<void>;
  }) {
    return renderHook(({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave }) =>
      useIdleActions({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave }),
      { initialProps: props }
    );
  }

  it('exports a sixty second pre-leave warning window', () => {
    expect(PRE_LEAVE_WARNING_SEC).toBe(60);
  });

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

  it('runs auto-leave cleanup before sending leaveVoice', async () => {
    const order: string[] = [];
    vi.mocked(bridge.send).mockImplementation(() => {
      order.push('leave');
    });

    render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
      onBeforeAutoLeave: () => {
        order.push('cleanup');
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(order).toEqual(['cleanup', 'leave']);
  });

  it('waits for async auto-leave cleanup before sending leaveVoice', async () => {
    let finishCleanup: () => void = () => {};
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });

    render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
      onBeforeAutoLeave: () => cleanup,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.send).not.toHaveBeenCalled();

    await act(async () => {
      finishCleanup();
      await cleanup;
    });

    expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
  });

  it('shows pre-leave state sixty seconds before auto-leave', () => {
    const { result } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(bridge.send).not.toHaveBeenCalled();
    expect(result.current.preLeaveStartedAt).not.toBeNull();
    expect(result.current.preLeaveCancelledAt).toBeNull();
  });

  it('does not show pre-leave state when only one idle source reaches warning threshold', () => {
    const { result } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: 0,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(result.current.preLeaveStartedAt).toBeNull();
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('turns pre-leave state into cancelled state when activity returns', () => {
    const { result, rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(result.current.preLeaveStartedAt).not.toBeNull();

    rerender({ brmbleIdleSec: 1, systemIdleSec: 1, isLocked: false, inVoiceChannel: true });

    expect(result.current.preLeaveStartedAt).toBeNull();
    expect(result.current.preLeaveCancelledAt).not.toBeNull();
  });

  it('dismissPreLeaveCancelled clears the cancellation notification state', () => {
    const { result, rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });

    rerender({ brmbleIdleSec: 1, systemIdleSec: 1, isLocked: false, inVoiceChannel: true });

    expect(result.current.preLeaveCancelledAt).not.toBeNull();
    act(() => result.current.dismissPreLeaveCancelled());
    expect(result.current.preLeaveCancelledAt).toBeNull();
  });

  it('clears and rearms pre-leave state when voice channel membership changes', () => {
    const { result, rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });

    const firstStartedAt = result.current.preLeaveStartedAt;
    expect(firstStartedAt).not.toBeNull();

    rerender({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: false,
    });

    expect(result.current.preLeaveStartedAt).toBeNull();
    expect(result.current.preLeaveCancelledAt).toBeNull();

    rerender({
      brmbleIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(result.current.preLeaveStartedAt).not.toBeNull();
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

  it('re-arms when any source drops below threshold (not just brmbleIdle === 0)', () => {
    const { rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
    });
    expect(bridge.send).toHaveBeenCalledTimes(1);

    // User moves mouse (system idle drops, brmble idle stays high briefly due to 5s tick)
    rerender({ brmbleIdleSec: AFK_THRESHOLD_SEC - 1, systemIdleSec: 3, isLocked: false, inVoiceChannel: true });

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
