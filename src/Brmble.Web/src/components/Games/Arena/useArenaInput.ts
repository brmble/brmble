import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import bridge from '../../../bridge';
import type { ArenaInputState, ArenaPlayerSnapshot } from './arenaProtocol';
import type { ArenaConnection } from './useArenaConnection';
import type { ArenaRenderer } from './ArenaRenderer';

const MAX_AXIS = 32767;
const DIAGONAL_AXIS = 23170;
const neutralInput: ArenaInputState = {
  moveX: 0, moveY: 0, aimX: MAX_AXIS, aimY: 0,
  charging: false, fireReleased: false, dash: false,
};

interface ArenaInputOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  renderer: ArenaRenderer | null;
  localPlayerRef: RefObject<Pick<ArenaPlayerSnapshot, 'x' | 'y'> | null>;
  connection: ArenaConnection;
  enabled: boolean;
  combatEnabled: boolean;
}

export function useArenaInput({ canvasRef, renderer, localPlayerRef, connection, enabled, combatEnabled }: ArenaInputOptions) {
  const captureIdRef = useRef<string | null>(null);
  captureIdRef.current ??= crypto.randomUUID();
  const captureId = captureIdRef.current;
  const capturedRef = useRef(false);
  const acquisitionRef = useRef(0);
  const enabledRef = useRef(enabled);
  const combatEnabledRef = useRef(combatEnabled);
  const rendererRef = useRef(renderer);
  const connectionRef = useRef(connection);
  const heldRef = useRef(new Set<string>());
  const inputRef = useRef<ArenaInputState>(neutralInput);
  const [captured, setCaptured] = useState(false);

  enabledRef.current = enabled;
  combatEnabledRef.current = combatEnabled;
  rendererRef.current = renderer;
  connectionRef.current = connection;

  const send = (patch: Partial<ArenaInputState>) => {
    const next = { ...inputRef.current, fireReleased: false, dash: false, ...patch };
    inputRef.current = { ...next, fireReleased: false, dash: false };
    connectionRef.current.sendInput(next);
  };

  const sendCaptureState = (active: boolean, onFailure?: () => void) => {
    try {
      const result = (bridge.send as unknown as (type: string, data: unknown) => unknown)(
        'game.inputCapture', { captureId, active },
      );
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(result).catch(() => onFailure?.());
      }
      return true;
    } catch {
      onFailure?.();
      return false;
    }
  };

  const release = () => {
    if (!capturedRef.current) return;
    acquisitionRef.current++;
    capturedRef.current = false;
    heldRef.current.clear();
    inputRef.current = neutralInput;
    setCaptured(false);
    try {
      if (connectionRef.current.status === 'connected') connectionRef.current.sendInput(neutralInput);
    } catch {
      // Local cleanup and native release must still complete if the socket send fails.
    } finally {
      sendCaptureState(false);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const capture = () => {
      if (capturedRef.current || !enabledRef.current || connectionRef.current.status !== 'connected' || !rendererRef.current) return;
      const acquisition = ++acquisitionRef.current;
      capturedRef.current = true;
      setCaptured(true);
      sendCaptureState(true, () => {
        if (capturedRef.current && acquisitionRef.current === acquisition) release();
      });
    };
    const movement = () => {
      const horizontal = Number(heldRef.current.has('KeyD')) - Number(heldRef.current.has('KeyA'));
      const vertical = Number(heldRef.current.has('KeyS')) - Number(heldRef.current.has('KeyW'));
      const diagonal = horizontal !== 0 && vertical !== 0;
      send({
        moveX: horizontal * (diagonal ? DIAGONAL_AXIS : MAX_AXIS),
        moveY: vertical * (diagonal ? DIAGONAL_AXIS : MAX_AXIS),
      });
    };
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!capturedRef.current) return;
      consume(event);
      if (event.code === 'Escape') {
        release();
        return;
      }
      if (event.code === 'Space') {
        if (!combatEnabledRef.current) return;
        if (!event.repeat && !heldRef.current.has(event.code)) {
          heldRef.current.add(event.code);
          send({ dash: true });
        }
        return;
      }
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code) || heldRef.current.has(event.code)) return;
      heldRef.current.add(event.code);
      movement();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!capturedRef.current) return;
      consume(event);
      if (event.code === 'Space') {
        heldRef.current.delete(event.code);
        return;
      }
      if (!heldRef.current.delete(event.code)) return;
      movement();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!capturedRef.current) return;
      consume(event);
      const world = rendererRef.current?.pointerToWorld(event.clientX, event.clientY);
      const localPlayer = localPlayerRef.current;
      if (!world || !localPlayer) return;
      const aimX = world.x - localPlayer.x;
      const aimY = world.y - localPlayer.y;
      const length = Math.hypot(aimX, aimY);
      if (length === 0) return;
      send({ aimX: Math.round(aimX / length * MAX_AXIS), aimY: Math.round(aimY / length * MAX_AXIS) });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!capturedRef.current) return;
      consume(event);
      // Track the physical button even while combat is closed. The countdown tells
      // the player to hold, and a press there produces the only pointerdown we will
      // ever get — the button is already down when the round goes live.
      if (event.button === 0 && !heldRef.current.has('MouseLeft')) {
        heldRef.current.add('MouseLeft');
        if (combatEnabledRef.current) send({ charging: true });
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!capturedRef.current) return;
      consume(event);
      if (event.button === 0 && heldRef.current.delete('MouseLeft') && combatEnabledRef.current) {
        send({ charging: false, fireReleased: true });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };

    canvas.addEventListener('click', capture, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('blur', release, true);
    document.addEventListener('visibilitychange', onVisibility, true);
    return () => {
      release();
      canvas.removeEventListener('click', capture, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('blur', release, true);
      document.removeEventListener('visibilitychange', onVisibility, true);
    };
  }, [canvasRef]);

  useLayoutEffect(() => {
    if (!enabled || connection.status !== 'connected') release();
  }, [connection.status, enabled]);

  useLayoutEffect(() => {
    if (combatEnabled) {
      // Combat just opened. A button the player is already holding produced its only
      // pointerdown while combat was closed, so start its charge now rather than
      // making them release and press again. Dash is deliberately not mirrored here:
      // it is a press action, and auto-dashing on the round start would surprise.
      if (capturedRef.current && heldRef.current.has('MouseLeft') && !inputRef.current.charging) {
        send({ charging: true });
      }
      return;
    }
    heldRef.current.delete('Space');
    if (capturedRef.current && inputRef.current.charging) {
      send({ charging: false, fireReleased: false, dash: false });
    }
  }, [combatEnabled]);

  return { captured, captureId, release };
}
