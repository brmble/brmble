import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from '../../../bridge';
import type { ArenaInputState, ArenaPlayerSnapshot } from './arenaProtocol';
import type { ArenaConnection } from './useArenaConnection';
import { useArenaInput } from './useArenaInput';
import { createServerClock } from './serverClock';

vi.mock('../../../bridge', () => ({ default: { send: vi.fn() } }));

const neutral: ArenaInputState = {
  moveX: 0, moveY: 0, aimX: 32767, aimY: 0,
  charging: false, fireReleased: false, dash: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function inputHarness(
  status: ArenaConnection['status'] = 'connected',
  reactStrictMode = false,
  localPlayer: Pick<ArenaPlayerSnapshot, 'x' | 'y'> = { x: 0, y: 0 },
  combatEnabled = true,
) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const canvasRef = { current: canvas };
  const sent: ArenaInputState[] = [];
  const connection: ArenaConnection = {
    status, welcome: null, latestSnapshot: null, closed: null,
    pendingInputs: [], recentInputs: [], pendingInputCount: 0, currentInput: neutral,
    serverClock: createServerClock(),
    sendInput: vi.fn(input => sent.push(input)), sendHeartbeat: vi.fn(),
  };
  const renderer = { pointerToWorld: vi.fn(() => ({ x: 0, y: -1000 })) };
  const localPlayerRef = { current: localPlayer };
  const hook = renderHook(
    ({ enabled, combatEnabled }) => useArenaInput({ canvasRef, renderer: renderer as never, localPlayerRef, connection, enabled, combatEnabled }),
    { initialProps: { enabled: true, combatEnabled }, reactStrictMode },
  );
  const keyDown = (code: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
  };
  const keyUp = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
  const clickBoard = () => fireEvent.click(canvas);
  const releaseBy = (reason: 'Escape' | 'blur' | 'visibilitychange' | 'socket' | 'unmount') => {
    if (reason === 'Escape') keyDown('Escape');
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'visibilitychange') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    if (reason === 'socket') hook.rerender({ enabled: false, combatEnabled });
    if (reason === 'unmount') hook.unmount();
  };
  return { canvas, connection, renderer, localPlayerRef, hook, sent, keyDown, keyUp, clickBoard, releaseBy };
}

describe('useArenaInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('starts charging when combat opens with fire already held', () => {
    // The legend says "Hold to shoot" during the countdown, where combat is disabled.
    // A press there is dropped, and the button is already down when the round goes
    // live, so pointerdown cannot fire again — nothing would ever start the charge.
    const h = inputHarness('connected', false, { x: 0, y: 0 }, false);
    h.clickBoard();
    fireEvent.pointerDown(h.canvas, { button: 0 });
    expect(h.sent).not.toContainEqual(expect.objectContaining({ charging: true }));

    h.hook.rerender({ enabled: true, combatEnabled: true });

    expect(h.sent.at(-1)).toMatchObject({ charging: true });
  });

  it('does not start charging when combat opens with fire released', () => {
    const h = inputHarness('connected', false, { x: 0, y: 0 }, false);
    h.clickBoard();
    fireEvent.pointerDown(h.canvas, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });

    h.hook.rerender({ enabled: true, combatEnabled: true });

    expect(h.sent).not.toContainEqual(expect.objectContaining({ charging: true }));
  });

  it('resumes charging when a cooldown closes and reopens combat under a held button', () => {
    // combatEnabled also covers the shot cooldown, so this is the mid-match case:
    // hold through your own cooldown and the next charge must start on its own.
    const h = inputHarness();
    h.clickBoard();
    fireEvent.pointerDown(h.canvas, { button: 0 });
    expect(h.sent.at(-1)).toMatchObject({ charging: true });

    h.hook.rerender({ enabled: true, combatEnabled: false });
    expect(h.sent.at(-1)).toMatchObject({ charging: false });

    h.hook.rerender({ enabled: true, combatEnabled: true });

    expect(h.sent.at(-1)).toMatchObject({ charging: true });
  });

  it('captures only after a board click and normalizes diagonal movement', () => {
    const h = inputHarness();
    h.keyDown('KeyW');
    expect(h.sent).toHaveLength(0);

    h.clickBoard();
    h.keyDown('KeyW');
    h.keyDown('KeyD');

    expect(h.sent.at(-1)).toMatchObject({ moveX: 23170, moveY: -23170 });
    expect(bridge.send).toHaveBeenCalledWith('game.inputCapture', {
      captureId: h.hook.result.current.captureId, active: true,
    });
    h.hook.unmount();
  });

  it('maps pointer aim through the renderer and left hold/release to charge and fire edges', () => {
    const h = inputHarness();
    h.clickBoard();
    fireEvent.pointerMove(h.canvas, { clientX: 140, clientY: 90 });
    fireEvent.pointerDown(h.canvas, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });

    expect(h.renderer.pointerToWorld).toHaveBeenCalledWith(140, 90);
    expect(h.sent).toContainEqual(expect.objectContaining({ aimX: 0, aimY: -32767 }));
    expect(h.sent).toContainEqual(expect.objectContaining({ charging: true, fireReleased: false }));
    expect(h.sent.at(-1)).toMatchObject({ charging: false, fireReleased: true });
    h.hook.unmount();
  });

  it.each([
    ['left spawn toward center', { x: -3500, y: 0 }, { x: 0, y: 0 }, { aimX: 32767, aimY: 0 }],
    ['right spawn toward center', { x: 3500, y: 0 }, { x: 0, y: 0 }, { aimX: -32767, aimY: 0 }],
    ['off-origin directly above', { x: 1200, y: -800 }, { x: 1200, y: -1800 }, { aimX: 0, aimY: -32767 }],
    ['off-origin directly left', { x: 1200, y: -800 }, { x: 200, y: -800 }, { aimX: -32767, aimY: 0 }],
  ] as const)('aims relative to the local player from %s', (_label, localPlayer, pointer, expected) => {
    const h = inputHarness('connected', false, localPlayer);
    h.renderer.pointerToWorld.mockReturnValue(pointer);
    h.clickBoard();

    fireEvent.pointerMove(h.canvas, { clientX: 140, clientY: 90 });

    expect(h.renderer.pointerToWorld).toHaveBeenCalledWith(140, 90);
    expect(h.sent.at(-1)).toMatchObject(expected);
    h.hook.unmount();
  });

  it('uses the shared integer normalization for diagonal pointer aim', () => {
    const h = inputHarness('connected', false, { x: 0, y: 0 });
    h.renderer.pointerToWorld.mockReturnValue({ x: 1000, y: 1000 });
    h.clickBoard();

    fireEvent.pointerMove(h.canvas);

    expect(h.sent.at(-1)).toMatchObject({ aimX: 23170, aimY: 23170 });
    h.hook.unmount();
  });

  it('retains the last nonzero aim when the pointer is exactly at the moving player without reinstalling listeners', () => {
    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const addCanvasListener = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const h = inputHarness('connected', false, { x: 100, y: 200 });
    h.clickBoard();
    h.renderer.pointerToWorld.mockReturnValue({ x: 100, y: -800 });
    fireEvent.pointerMove(h.canvas);
    expect(h.sent.at(-1)).toMatchObject({ aimX: 0, aimY: -32767 });
    const sentBeforeCoincidence = h.sent.length;
    const windowListeners = addWindowListener.mock.calls.length;
    const canvasListeners = addCanvasListener.mock.calls.length;

    h.localPlayerRef.current = { x: 500, y: 600 };
    h.renderer.pointerToWorld.mockReturnValue({ x: 500, y: 600 });
    h.hook.rerender({ enabled: true, combatEnabled: true });
    fireEvent.pointerMove(h.canvas);

    expect(h.sent).toHaveLength(sentBeforeCoincidence);
    expect(h.connection.currentInput).not.toMatchObject({ aimX: 0, aimY: 0 });
    expect(addWindowListener).toHaveBeenCalledTimes(windowListeners);
    expect(addCanvasListener).toHaveBeenCalledTimes(canvasListeners);
    addWindowListener.mockRestore();
    addCanvasListener.mockRestore();
    h.hook.unmount();
  });

  it('ignores key repeat for dash and sends exactly one edge per physical press', () => {
    const h = inputHarness();
    h.clickBoard();
    h.keyDown('Space');
    h.keyDown('Space', { repeat: true });
    h.keyUp('Space');
    expect(h.sent.filter(input => input.dash)).toHaveLength(1);
    h.hook.unmount();
  });

  it('keeps movement active while combat input is disabled', () => {
    const h = inputHarness('connected', false, { x: 0, y: 0 }, false);
    h.clickBoard();

    h.keyDown('KeyW');
    h.keyDown('Space');
    fireEvent.pointerDown(h.canvas, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });

    expect(h.sent).toContainEqual(expect.objectContaining({ moveY: -32767 }));
    expect(h.sent.some(input => input.dash || input.charging || input.fireReleased)).toBe(false);
    h.hook.unmount();
  });

  it('releases held charge without firing when combat becomes disabled', () => {
    const h = inputHarness();
    h.clickBoard();
    fireEvent.pointerDown(h.canvas, { button: 0 });
    expect(h.sent.at(-1)).toMatchObject({ charging: true });

    h.hook.rerender({ enabled: true, combatEnabled: false });

    expect(h.sent.at(-1)).toMatchObject({ charging: false, fireReleased: false, dash: false });
    h.hook.unmount();
  });

  it.each(['Escape', 'blur', 'visibilitychange', 'socket', 'unmount'] as const)(
    '%s synchronously releases capture with exactly one neutral input', reason => {
      const h = inputHarness();
      h.clickBoard();
      h.keyDown('KeyW');
      vi.mocked(bridge.send).mockClear();
      const before = h.sent.length;

      act(() => h.releaseBy(reason));

      expect(h.sent.slice(before)).toEqual([neutral]);
      expect(bridge.send).toHaveBeenCalledTimes(1);
      expect(bridge.send).toHaveBeenLastCalledWith('game.inputCapture', {
        captureId: h.hook.result.current?.captureId ?? expect.any(String), active: false,
      });
      if (reason !== 'unmount') h.hook.unmount();
    },
  );

  it('does not swallow chat shortcuts after capture is released', () => {
    const h = inputHarness();
    h.clickBoard();
    act(() => h.releaseBy('Escape'));
    const event = h.keyDown('KeyW');
    expect(event.defaultPrevented).toBe(false);
    h.hook.unmount();
  });

  it('does not capture while disabled or disconnected', () => {
    const h = inputHarness('reconnecting');
    h.clickBoard();
    h.keyDown('KeyW');
    expect(h.hook.result.current.captured).toBe(false);
    expect(h.sent).toHaveLength(0);
    expect(bridge.send).not.toHaveBeenCalled();
    h.hook.unmount();
  });

  it('creates one capture UUID for the mounted hook across rerenders', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    const h = inputHarness();
    const captureId = h.hook.result.current.captureId;

    h.hook.rerender({ enabled: false, combatEnabled: true });
    h.hook.rerender({ enabled: true, combatEnabled: true });

    expect(h.hook.result.current.captureId).toBe(captureId);
    expect(randomUUID).toHaveBeenCalledOnce();
    h.hook.unmount();
  });

  it('pairs the committed StrictMode capture UUID without effect-replay bridge messages', () => {
    const h = inputHarness('connected', true);
    h.clickBoard();
    const captureId = h.hook.result.current.captureId;
    h.hook.unmount();

    expect(vi.mocked(bridge.send).mock.calls).toEqual([
      ['game.inputCapture', { captureId, active: true }],
      ['game.inputCapture', { captureId, active: false }],
    ]);
  });

  it('still deactivates capture when neutral input throws during release', () => {
    const h = inputHarness();
    h.clickBoard();
    vi.mocked(h.connection.sendInput).mockImplementation(() => { throw new Error('socket send failed'); });
    vi.mocked(bridge.send).mockClear();

    expect(() => act(() => h.releaseBy('Escape'))).not.toThrow();

    expect(h.hook.result.current.captured).toBe(false);
    expect(bridge.send).toHaveBeenCalledOnce();
    expect(bridge.send).toHaveBeenCalledWith('game.inputCapture', {
      captureId: h.hook.result.current.captureId, active: false,
    });
    h.hook.unmount();
  });

  it('swallows synchronous and rejected bridge release failures after local cleanup', async () => {
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const h = inputHarness();
    h.clickBoard();
    vi.mocked(bridge.send).mockImplementationOnce(() => { throw new Error('bridge failed'); });
    expect(() => act(() => h.releaseBy('Escape'))).not.toThrow();
    expect(h.hook.result.current.captured).toBe(false);

    h.clickBoard();
    vi.mocked(bridge.send).mockImplementationOnce(() => Promise.reject(new Error('bridge rejected')) as never);
    expect(() => act(() => h.releaseBy('Escape'))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', unhandled);
    h.hook.unmount();
  });

  it('rolls back local capture and neutralizes when activation throws', () => {
    const h = inputHarness();
    vi.mocked(bridge.send).mockImplementationOnce(() => { throw new Error('activation failed'); });

    expect(() => h.clickBoard()).not.toThrow();

    expect(h.hook.result.current.captured).toBe(false);
    expect(h.sent).toEqual([neutral]);
    h.hook.unmount();
  });

  it('rolls back local capture and neutralizes when activation rejects', async () => {
    const h = inputHarness();
    vi.mocked(bridge.send).mockImplementationOnce(() => Promise.reject(new Error('activation rejected')) as never);

    h.clickBoard();

    await waitFor(() => expect(h.hook.result.current.captured).toBe(false));
    expect(h.sent).toEqual([neutral]);
    h.hook.unmount();
  });

  it('ignores rejection from an old acquisition after a newer capture starts', async () => {
    const first = deferred<void>();
    vi.mocked(bridge.send)
      .mockImplementationOnce(() => first.promise as never)
      .mockImplementation(() => undefined);
    const h = inputHarness();
    h.clickBoard();
    act(() => h.releaseBy('Escape'));
    h.clickBoard();
    const callsBeforeRejection = vi.mocked(bridge.send).mock.calls.length;
    const inputsBeforeRejection = h.sent.length;

    first.reject(new Error('stale activation'));
    await act(async () => { await Promise.resolve(); });

    expect(h.hook.result.current.captured).toBe(true);
    expect(vi.mocked(bridge.send).mock.calls).toHaveLength(callsBeforeRejection);
    expect(h.sent).toHaveLength(inputsBeforeRejection);
    h.hook.unmount();
  });

  it('rolls back only the current deferred acquisition when it rejects', async () => {
    const current = deferred<void>();
    vi.mocked(bridge.send).mockImplementationOnce(() => current.promise as never);
    const h = inputHarness();
    h.clickBoard();

    current.reject(new Error('current activation'));
    await act(async () => { await Promise.resolve(); });

    expect(h.hook.result.current.captured).toBe(false);
    expect(h.sent).toEqual([neutral]);
    expect(bridge.send).toHaveBeenLastCalledWith('game.inputCapture', {
      captureId: h.hook.result.current.captureId, active: false,
    });
    h.hook.unmount();
  });

  it('ignores deferred activation rejection after unmount cleanup', async () => {
    const activation = deferred<void>();
    vi.mocked(bridge.send).mockImplementationOnce(() => activation.promise as never);
    const h = inputHarness();
    h.clickBoard();
    h.hook.unmount();
    const callsBeforeRejection = vi.mocked(bridge.send).mock.calls.length;
    const inputsBeforeRejection = h.sent.length;

    activation.reject(new Error('unmounted activation'));
    await act(async () => { await Promise.resolve(); });

    expect(vi.mocked(bridge.send).mock.calls).toHaveLength(callsBeforeRejection);
    expect(h.sent).toHaveLength(inputsBeforeRejection);
  });
});
