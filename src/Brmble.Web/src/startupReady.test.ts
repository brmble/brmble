import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from './bridge';
import { signalAppReadyAfterPaint } from './startupReady';

vi.mock('./bridge', () => ({
  default: {
    send: vi.fn(),
  },
}));

describe('signalAppReadyAfterPaint', () => {
  let nextFrameId: number;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 1;
    callbacks = new Map();
    vi.mocked(bridge.send).mockReset();

    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    }));

    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      callbacks.delete(id);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const runNextFrame = () => {
    const next = callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;

    if (!next) {
      throw new Error('Expected a queued animation frame');
    }

    const [id, callback] = next;
    callbacks.delete(id);
    callback(0);
  };

  it('sends app.ready only after two animation-frame callbacks', () => {
    signalAppReadyAfterPaint();

    expect(bridge.send).not.toHaveBeenCalled();

    runNextFrame();
    expect(bridge.send).not.toHaveBeenCalled();

    runNextFrame();
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(bridge.send).toHaveBeenCalledWith('app.ready');
  });

  it('cancels the second frame if React cleans up after the first frame', () => {
    const cancel = signalAppReadyAfterPaint();

    runNextFrame();
    cancel();

    expect(callbacks.size).toBe(0);
    expect(bridge.send).not.toHaveBeenCalled();
  });
});
