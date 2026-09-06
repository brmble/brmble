import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PREDICTION_V1, type ArenaPlayerSnapshot } from './arenaProtocol';
import { ArenaRenderer, FALLBACK_AVATAR_SRC, type ArenaRenderView } from './ArenaRenderer';

type Recorded = {
  op: string; args: unknown[]; strokeStyle?: string; fillStyle?: string; lineWidth?: number; globalAlpha?: number;
};

function player(sessionId: number, side: 0 | 1, overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot {
  return {
    sessionId, side, x: side ? 3000 : -3000, y: 0, vx: 0, vy: 0,
    aimX: side ? -32767 : 32767, aimY: 0, chargePermille: 0,
    forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true,
    acknowledgedInput: 0, ...overrides,
  };
}

function view(overrides: Partial<ArenaRenderView> = {}): ArenaRenderView {
  return {
    selfSessionId: 10,
    players: [player(10, 0), player(20, 1)],
    projectiles: [], arena: { radius: 8000, shrinkPhase: 'hold' },
    names: { 10: 'Local', 20: 'Remote' }, avatarUrls: {}, prediction: PREDICTION_V1, knockout: [], ...overrides,
  };
}

function setup() {
  const calls: Recorded[] = [];
  const context = new Proxy({
    canvas: null, strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D, {
    get(target, property) {
      if (property in target) return target[property as keyof CanvasRenderingContext2D];
      return (...args: unknown[]) => calls.push({
        op: String(property), args,
        strokeStyle: String(target.strokeStyle),
        fillStyle: String(target.fillStyle),
        lineWidth: target.lineWidth,
        globalAlpha: target.globalAlpha,
      });
    },
    set(target, property, value) {
      Reflect.set(target, property, value);
      return true;
    },
  });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: () => context });
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 50, top: 25, width: 1000, height: 600, right: 1050, bottom: 625, x: 50, y: 25, toJSON: () => ({}) }),
  });
  const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => ({
      '--bg-surface': 'surface', '--bg-primary': 'floor', '--bg-deep': 'deep',
      '--text-primary': 'text', '--text-muted': 'muted',
      '--accent-primary': 'primary', '--accent-danger': 'danger', '--font-body': 'body', '--font-mono': 'mono',
      '--font-display': 'display', '--text-xs': '12px', '--text-sm': '14px',
    })[name] ?? '',
  } as CSSStyleDeclaration);
  const parent = document.createElement('div');
  parent.appendChild(canvas);
  const renderer = new ArenaRenderer(canvas);
  renderer.resize(1000, 600, 2);
  return { renderer, canvas, calls, style, context };
}

describe('ArenaRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });

  it('uses a DPR-correct letterbox and maps pointer client coordinates through its exact inverse', () => {
    const { renderer, canvas } = setup();
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1200);
    expect(renderer.pointerToWorld(550, 325)).toEqual({ x: 0, y: 0 });
    renderer.resize(600, 1000, 1);
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 50, top: 25, width: 600, height: 1000, right: 650, bottom: 1025, x: 50, y: 25, toJSON: () => ({}) }),
    });
    expect(renderer.pointerToWorld(350, 525)).toEqual({ x: 0, y: 0 });
  });

  it('draws every body aim, caps charge at 2200, and includes forced-fire text', () => {
    const { renderer, calls } = setup();
    renderer.render(view({ players: [
      player(10, 0, { chargePermille: 1000, forcedFireTicks: 18 }), player(20, 1),
    ] }), { reducedMotion: false });
    expect(calls.filter(call => call.op === 'lineTo' && call.args[0] === 500)).toHaveLength(2);
    expect(calls.filter(call => call.op === 'lineTo' && call.args[0] === 476)).toHaveLength(1);
    expect(calls.some(call => call.op === 'fillText' && call.args[0] === '18')).toBe(true);
  });

  it('draws cooldown and dash markers only for the local body', () => {
    const { renderer, calls } = setup();
    calls.length = 0;
    renderer.render(view({ players: [
      player(10, 0, { cooldownTicks: 12, dashAvailable: true }),
      player(20, 1, { cooldownTicks: 12, dashAvailable: true }),
    ] }), { reducedMotion: false });
    expect(calls.filter(call => call.op === 'fillText' && call.args[0] === '12')).toHaveLength(1);
    expect(calls.filter(call => call.op === 'fillText' && call.args[0] === 'DASH')).toHaveLength(1);
  });

  it('uses the Brmble logo immediately when an avatar is missing or fails', () => {
    const { renderer, calls } = setup();
    renderer.render(view({ avatarUrls: { 10: 'broken-avatar' } }), { reducedMotion: false });
    expect(calls.some(call => call.op === 'fillText' && call.args[0] === 'B')).toBe(true);
    expect(calls.filter(call => call.op === 'drawImage')).toHaveLength(0);
  });

  it('uses a loaded logo after an incomplete or broken avatar fallback', () => {
    const images: HTMLImageElement[] = [];
    vi.stubGlobal('Image', class {
      src = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      complete = false; naturalWidth = 0;
      constructor() { images.push(this as unknown as HTMLImageElement); }
    });
    const { renderer, calls } = setup();
    renderer.render(view({ avatarUrls: { 10: 'broken-avatar' } }), { reducedMotion: false });
    images.find(image => image.src === 'broken-avatar')?.onerror?.(new Event('error'));
    const logo = images.find(image => image.src.includes(FALLBACK_AVATAR_SRC))!;
    Object.assign(logo, { complete: true, naturalWidth: 24 });
    calls.length = 0;
    renderer.render(view({ avatarUrls: { 10: 'broken-avatar' } }), { reducedMotion: false });
    expect(calls.some(call => call.op === 'drawImage' && call.args[0] === logo)).toBe(true);
  });

  it('draws clipped bodies with distinct side outlines and opposite notches', () => {
    const { renderer, calls } = setup();
    calls.length = 0;
    renderer.render(view(), { reducedMotion: false });
    expect(calls.filter(call => call.op === 'clip')).toHaveLength(2);
    expect(calls.filter(call => call.op === 'arc' && call.args[2] === 18)).toHaveLength(4);
    expect(calls.filter(call => call.op === 'arc' && call.args[2] === 13.5)).toHaveLength(1);
    const notchTips = calls.filter(call => call.op === 'lineTo' && call.args[1] === 300)
      .map(call => call.args[0] as number).filter(x => x !== 500);
    expect(Math.min(...notchTips)).toBeLessThan(410);
    expect(Math.max(...notchTips)).toBeGreaterThan(590);
  });

  it('draws a non-colour owner marker and outline on projectiles', () => {
    const { renderer, calls } = setup();
    calls.length = 0;
    renderer.render(view({ projectiles: [
      { id: 1, ownerSessionId: 10, x: -1000, y: 0, vx: 0, vy: 0, chargePermille: 0 },
      { id: 2, ownerSessionId: 20, x: 1000, y: 0, vx: 0, vy: 0, chargePermille: 0 },
    ] }), { reducedMotion: true });
    const thinStrokes = calls.filter(call => call.op === 'stroke' && Math.abs((call.lineWidth ?? 0) - 1.35) < 0.001);
    expect(thinStrokes.length).toBeGreaterThanOrEqual(4);
    const markerStarts = calls.filter(call => call.op === 'moveTo' && call.args[1] === 294.6).map(call => call.args[0] as number);
    expect(markerStarts).toEqual(expect.arrayContaining([470, 530]));
  });

  it('places the shrink label at a fixed battlefield edge regardless of radius', () => {
    const first = setup();
    first.renderer.render(view({ arena: { radius: 8000, shrinkPhase: 'normal' } }), { reducedMotion: false });
    const firstLabel = first.calls.find(call => call.op === 'fillText' && call.args[0] === 'NORMAL')!;
    const second = setup();
    second.renderer.render(view({ arena: { radius: 4000, shrinkPhase: 'normal' } }), { reducedMotion: false });
    const secondLabel = second.calls.find(call => call.op === 'fillText' && call.args[0] === 'NORMAL')!;
    expect(firstLabel.args.slice(1)).toEqual(secondLabel.args.slice(1));
  });

  it('removes moving trails under reduced motion without changing body positions or state cues', () => {
    const projectile = { id: 1, ownerSessionId: 10, x: 0, y: 0, vx: 240, vy: 0, chargePermille: 500 };
    const normal = setup();
    normal.renderer.render(view({ projectiles: [projectile] }), { reducedMotion: false });
    const reduced = setup();
    reduced.renderer.render(view({ projectiles: [projectile] }), { reducedMotion: true });
    expect(normal.calls.filter(call => call.op === 'lineTo').length).toBeGreaterThan(reduced.calls.filter(call => call.op === 'lineTo').length);
    expect(normal.calls.filter(call => call.op === 'arc').map(call => call.args.slice(0, 3)))
      .toEqual(reduced.calls.filter(call => call.op === 'arc').map(call => call.args.slice(0, 3)));
  });

  it('points the rear marker opposite the aim vector rather than at a fixed side', () => {
    // The marker is the only closePath in the renderer, so the three calls before
    // it are its vertices, in draw order: base corner, apex, base corner.
    const rearMarker = (calls: Recorded[]) => {
      const end = calls.findIndex(call => call.op === 'closePath');
      const [baseA, apex, baseB] = calls.slice(end - 3, end).map(call => call.args as [number, number]);
      return { baseA, apex, baseB };
    };
    // World origin maps to CSS (500, 300); scale is 600/20000 = 0.03.
    const down = setup();
    down.renderer.render(
      view({ players: [player(10, 0, { x: 0, y: 0, aimX: 0, aimY: 32767 })] }),
      { reducedMotion: false },
    );
    const marker = rearMarker(down.calls);
    // Aim is +y, so the rear apex sits at -y: 300 - (600 + 300) * 0.03 = 273.
    expect(marker.apex).toEqual([500, 273]);
    // Base corners straddle the body edge at 600 * 0.03 = 18, offset by line(180) = 5.4.
    expect(marker.baseA).toEqual([505.4, 282]);
    expect(marker.baseB).toEqual([494.6, 282]);

    // Same player, aim rotated to -x: the marker must follow it to +x.
    const leftward = setup();
    leftward.renderer.render(
      view({ players: [player(10, 0, { x: 0, y: 0, aimX: -32767, aimY: 0 })] }),
      { reducedMotion: false },
    );
    expect(rearMarker(leftward.calls).apex).toEqual([527, 300]);
  });

  it('falls back to the side direction when aim is zero-length', () => {
    const { renderer, calls } = setup();
    renderer.render(
      view({ players: [player(10, 0, { x: 0, y: 0, aimX: 0, aimY: 0 })] }),
      { reducedMotion: false },
    );
    const end = calls.findIndex(call => call.op === 'closePath');
    // Side 0 spawns aiming +x, so its rear falls back to -x: 500 - 27 = 473.
    expect(calls[end - 2].args).toEqual([473, 300]);
  });

  it('fills the void behind the arena and the floor inside it with different colours', () => {
    const { renderer, calls } = setup();

    renderer.render(view(), { reducedMotion: false });

    // The square is the void; the disc drawn on top of it is the floor.
    const square = calls.find(call => call.op === 'fillRect');
    expect(square?.fillStyle).toBe('deep');
    const floor = calls.findIndex(call => call.op === 'fill');
    expect(calls[floor].fillStyle).toBe('floor');
    // The floor disc is the ring's twin: same centre, same radius (8000 * 0.03).
    const discs = calls.filter(call => call.op === 'arc' && call.args[2] === 240);
    expect(discs).toHaveLength(2);
    expect(discs[0].args).toEqual(discs[1].args);
    // The floor is filled before the ring is stroked, so the lip sits on the seam.
    expect(floor).toBeLessThan(calls.findIndex(call => call.op === 'stroke'));
  });

  describe('knockout', () => {
    // World scale is 600/20000 = 0.03 and offsetX is 200, so world x maps to
    // 200 + (x + 10000) * 0.03. Bodies are PREDICTION_V1.playerRadius (600) -> 18.
    const bodyArcs = (calls: Recorded[], radius: number) =>
      calls.filter(call => call.op === 'arc' && call.args[2] === radius);

    it('suppresses the falling player and draws them at the animated position instead', () => {
      const { renderer, calls } = setup();
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0.5, puffRadius: 0, puffOpacity: 0 }],
      }), { reducedMotion: false });
      // The victim's avatar clip arc is drawn at the animated point, not at its
      // authoritative position.
      const clips = calls.filter(call => call.op === 'arc');
      expect(clips.some(call => call.args[0] === 500 + 10200 * 0.03)).toBe(true);
      // Nothing at all is drawn at the victim's authoritative x of -3000 -> 410.
      expect(clips.some(call => call.args[0] === 410)).toBe(false);
      // The body shrinks with the sampled scale: 18 * 0.5.
      expect(bodyArcs(calls, 9).length).toBeGreaterThan(0);
      // The falling body is drawn under the ring lip, so the player visibly
      // passes behind the arena edge. The floor disc and the ring are both
      // 240-radius twins and the ring is the later of the two, so the last such
      // arc is the lip. Selecting the first `stroke` instead would be vacuous
      // here: a body is drawn at this scale, so the first stroke is its own
      // outline, and a clip always precedes the outline it belongs to.
      const ringArc = calls.reduce((last, call, i) =>
        call.op === 'arc' && call.args[2] === 240 ? i : last, -1);
      expect(calls.findIndex(call => call.op === 'clip')).toBeLessThan(ringArc);
      // The fade is applied and then restored, so later draws are opaque.
      expect(bodyArcs(calls, 9)[0].globalAlpha).toBe(0.5);
      expect(calls[calls.length - 1].globalAlpha).toBe(1);
    });

    it('leaves the surviving player untouched during a knockout', () => {
      const { renderer, calls } = setup();
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0.5, puffRadius: 0, puffOpacity: 0 }],
      }), { reducedMotion: false });
      // Side 1 draws two full-size body arcs: the avatar clip and the outline.
      const survivor = bodyArcs(calls, 18);
      expect(survivor).toHaveLength(2);
      expect(survivor.every(call => call.args[0] === 590 && call.globalAlpha === 1)).toBe(true);
      expect(calls.some(call => call.op === 'fillText' && call.args[0] === 'Remote')).toBe(true);
      // ...and the victim keeps none of its trimmings.
      expect(calls.some(call => call.op === 'fillText' && call.args[0] === 'Local')).toBe(false);
      expect(calls.some(call => call.op === 'fillText' && call.args[0] === 'DASH')).toBe(false);
    });

    it('keeps the shrinking local body off a negative arc radius', () => {
      const { renderer, calls } = setup();
      // Side 0 draws an inner ring at playerRadius - 150. The falling body scales
      // that radius, so at 0.1 it is 600 * 0.1 - 150 = -90 world units, and arc()
      // throws IndexSizeError on a negative radius. `scale = 1 - fallProgress`
      // sweeps continuously to 0, so every knockout of the local player passes
      // through scale < 0.25 and would throw inside the rAF loop.
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0.1, puffRadius: 0, puffOpacity: 0 }],
      }), { reducedMotion: false });
      expect(calls.filter(call => call.op === 'arc')
        .every(call => (call.args[2] as number) >= 0)).toBe(true);
    });

    it('draws the dust ring once the body has gone', () => {
      const { renderer, calls } = setup();
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0, puffRadius: 1800, puffOpacity: 0.5 }],
      }), { reducedMotion: false });
      // 1800 * 0.03 = 54, at the animated point, faded and then restored.
      const dust = bodyArcs(calls, 54);
      expect(dust).toHaveLength(1);
      expect(dust[0].args[0]).toBe(806);
      expect(dust[0].globalAlpha).toBe(0.5);
      expect(calls[calls.length - 1].globalAlpha).toBe(1);
      // No body at all: the only full-size arcs left are the survivor's two, and
      // the survivor's is the only avatar clip on the board. A zero-scale body
      // would draw a zero-radius disc, which the radius filters cannot see.
      expect(bodyArcs(calls, 18)).toHaveLength(2);
      expect(calls.filter(call => call.op === 'clip')).toHaveLength(1);
      // The dust rises above the lip rather than being clipped by it.
      expect(calls.indexOf(dust[0])).toBeGreaterThan(calls.findIndex(call => call.op === 'stroke'));
    });

    it('draws no dust before the puff has any size', () => {
      const { renderer, calls } = setup();
      // A `vanishOnly` knockout opens at radius 0 with full opacity, so a gate on
      // opacity alone would stroke a degenerate zero-radius ring on the first frame.
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 1, puffRadius: 0, puffOpacity: 1 }],
      }), { reducedMotion: false });
      expect(bodyArcs(calls, 0)).toHaveLength(0);
      // The body is still there, so this is the puff gate failing and not the body one.
      expect(bodyArcs(calls, 18).some(call => call.args[0] === 806)).toBe(true);
    });

    it('draws no dust once it has fully faded', () => {
      const { renderer, calls } = setup();
      // The last frame of the animation is a full-size ring at zero opacity. It
      // is full-size, so the radius gate lets it through; stroking it would put
      // an invisible draw on the canvas every final frame.
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0, puffRadius: 1800, puffOpacity: 0 }],
      }), { reducedMotion: false });
      expect(bodyArcs(calls, 54)).toHaveLength(0);
      expect(calls.every(call => call.globalAlpha === 1)).toBe(true);
    });

    it('draws the dust for a victim who has already left the player list', () => {
      const { renderer, calls } = setup();
      renderer.render(view({
        players: [player(20, 1)],
        knockout: [{ sessionId: 10, x: 0, y: 0, scale: 1, puffRadius: 1800, puffOpacity: 1 }],
      }), { reducedMotion: false });
      expect(bodyArcs(calls, 54)).toHaveLength(1);
      // Scale is 1, so an unguarded body draw would add two more 18-radius arcs
      // on top of the surviving player's own two.
      expect(bodyArcs(calls, 18)).toHaveLength(2);
    });

    it('strokes the dust in the victim\'s side colour so reduced motion names who went off', () => {
      const { renderer, calls } = setup();
      // Under reduced motion the sampler delivers scale 0 from the first frame, so
      // the dust is the only thing drawn for the victim. In `neutral` it would be
      // the arena lip's own colour and carry no side identity at all.
      renderer.render(view({
        knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0, puffRadius: 1800, puffOpacity: 1 }],
      }), { reducedMotion: true });
      const dust = bodyArcs(calls, 54);
      expect(dust).toHaveLength(1);
      expect(dust[0].strokeStyle).toBe('primary');
      // ...and side 1 takes the other side's colour, not simply "not neutral".
      const other = setup();
      other.renderer.render(view({
        knockout: [{ sessionId: 20, x: 10200, y: 0, scale: 0, puffRadius: 1800, puffOpacity: 1 }],
      }), { reducedMotion: true });
      expect(bodyArcs(other.calls, 54)[0].strokeStyle).toBe('danger');
    });

    it('draws nothing extra when no knockout is running', () => {
      const { renderer, calls } = setup();
      renderer.render(view(), { reducedMotion: false });
      expect(calls.every(call => call.globalAlpha === 1)).toBe(true);
    });
  });

  it('stops rendering and releases image handlers when disposed', () => {
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string; complete: boolean; naturalWidth: number }> = [];
    vi.stubGlobal('Image', class {
      src = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      complete = false; naturalWidth = 0;
      constructor() { images.push(this); }
    });
    const { renderer, calls } = setup();
    renderer.render(view({ avatarUrls: { 10: 'avatar' } }), { reducedMotion: false });
    calls.length = 0;
    renderer.dispose();
    renderer.render(view(), { reducedMotion: false });
    expect(calls).toHaveLength(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(images.every(image => image.onload === null && image.onerror === null)).toBe(true);
  });
});
