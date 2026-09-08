import brmbleLogo from '../../../assets/brmble-logo.svg';
import type {
  ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaProjectileSnapshot, ArenaStateSnapshot,
} from './arenaProtocol';
import {
  computeLayout, rearVector, screenToWorld, shrinkIntensity, worldToScreen,
  type ArenaLayout, type FixedVec,
} from './arenaMath';
import type { ArenaKnockoutFrame } from './arenaKnockout';

export const FALLBACK_AVATAR_SRC = brmbleLogo;

export interface ArenaRenderView {
  selfSessionId: number;
  players: ArenaPlayerSnapshot[];
  projectiles: ArenaProjectileSnapshot[];
  arena: ArenaStateSnapshot['arena'];
  names: Record<number, string>;
  avatarUrls: Record<number, string | null | undefined>;
  prediction: ArenaPredictionConstants;
  knockout: ArenaKnockoutFrame[];
}

interface AvatarEntry {
  image: HTMLImageElement;
  source: string;
  ready: boolean;
  generation: number;
}

const WORLD_SIZE = 20_000;
const CHARGE_LENGTH = 2_200;
const AIM_LENGTH = 3_000;
// Half-width of the rear notch, and how far it bites into the radius.
const NOTCH_HALF_ANGLE = 0.42;
const NOTCH_DEPTH = 0.35;

export class ArenaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private layout: ArenaLayout = computeLayout(1, 1);
  private disposed = false;
  private generation = 0;
  private avatars = new Map<number, AvatarEntry>();
  private fallback: HTMLImageElement;
  private observer: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.fallback = this.makeImage(FALLBACK_AVATAR_SRC, true);
    const container = canvas.parentElement;
    if (container && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(entries => {
        const box = entries[0]?.contentRect ?? container.getBoundingClientRect();
        this.resize(box.width, box.height, window.devicePixelRatio || 1);
      });
      this.observer.observe(container);
      const box = container.getBoundingClientRect();
      this.resize(box.width, box.height, window.devicePixelRatio || 1);
    }
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    if (this.disposed) return;
    const width = Math.max(1, cssWidth);
    const height = Math.max(1, cssHeight);
    const ratio = Math.max(1, dpr);
    this.layout = computeLayout(width, height);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  pointerToWorld(clientX: number, clientY: number): FixedVec {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = (clientX - rect.left) * this.layout.cssWidth / Math.max(1, rect.width);
    const cssY = (clientY - rect.top) * this.layout.cssHeight / Math.max(1, rect.height);
    return screenToWorld({ x: cssX, y: cssY }, this.layout);
  }

  render(view: ArenaRenderView, options: { reducedMotion: boolean }) {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    const { projectileRadius } = view.prediction;
    const style = getComputedStyle(this.canvas);
    const color = (token: string) => style.getPropertyValue(token).trim();
    const primary = color('--accent-primary');
    const danger = color('--accent-danger');
    const neutral = color('--text-muted');
    const text = color('--text-primary');
    const floor = color('--bg-primary');
    const deep = color('--bg-deep');
    const scale = this.layout.size / WORLD_SIZE;
    const line = (worldWidth: number) => Math.max(1, worldWidth * scale);
    const point = (value: FixedVec) => worldToScreen(value, this.layout);

    ctx.clearRect(0, 0, this.layout.cssWidth, this.layout.cssHeight);
    // The void first, then the arena floor on top of it: the ring is the lip
    // between them, and a knocked-out player falls from one into the other.
    // The floor is --bg-primary, not --bg-surface: surface is a low-alpha rgba on
    // every theme but windows-2000, so over an opaque void it would composite back
    // to nearly the void itself and there would still be nothing to fall into.
    // The void covers the whole canvas, not just the square playfield. The arena
    // is letterboxed inside a wider box, so filling only the square leaves the
    // margins transparent and the panel shows through them.
    ctx.fillStyle = deep;
    ctx.fillRect(0, 0, this.layout.cssWidth, this.layout.cssHeight);

    const center = point({ x: 0, y: 0 });
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(center.x, center.y, view.arena.radius * scale, 0, Math.PI * 2);
    ctx.fill();

    // The falling bodies go down here, between the floor and the lip, so the ring
    // is stroked over them and the victim visibly passes behind the arena edge.
    // That occlusion is the animation's own depth cue and the only one that does
    // not depend on the floor and the void being distinguishable — on most themes
    // they are within 1.1:1 of each other, so the fall has to read without it.
    const falling = new Map(view.knockout.map(frame => [frame.sessionId, frame]));
    for (const frame of view.knockout) {
      // Scale reaches 0 when the body has finished falling; from there only the
      // dust remains. Reduced motion is delivered as scale 0 from the first frame,
      // and needs no branch of its own here.
      if (frame.scale <= 0) continue;
      // A forfeit or abandon can name a victim who is already off the board. There
      // is no body to fall, but the dust below still marks where they were.
      // Linear rather than a `falling` lookup: the map is keyed the wrong way for
      // this, and the arena is two players.
      const victim = view.players.find(player => player.sessionId === frame.sessionId);
      if (victim === undefined) continue;
      this.drawPlayer(ctx, victim, view, { primary, danger, neutral, text }, scale, line, point, frame);
    }

    // The lip carries the shrink phase itself: it reddens and thickens as the arena
    // closes, which a label at the edge of the battlefield never made urgent. Mixed
    // from the existing tokens so the ramp holds up on every theme. The phase is
    // still announced in the board's live region for screen readers.
    const intensity = shrinkIntensity(view.arena.radius);
    ctx.strokeStyle = `color-mix(in oklab, ${danger} ${Math.round(intensity * 100)}%, ${neutral})`;
    ctx.lineWidth = line(60 + 60 * intensity);
    ctx.beginPath();
    ctx.arc(center.x, center.y, view.arena.radius * scale, 0, Math.PI * 2);
    ctx.stroke();

    // The dust rises above the lip rather than being hidden behind it: it marks
    // the point of departure, which sits on the ring itself.
    for (const frame of view.knockout) {
      // Gate on opacity as well as radius: `vanishOnly` opens at radius 0 with
      // full opacity, so radius alone would blank the first frame of a forfeit.
      if (frame.puffRadius <= 0 || frame.puffOpacity <= 0) continue;
      const dust = point(frame);
      // The dust carries the victim's side colour. Under `prefers-reduced-motion`
      // the sampler delivers scale 0 from the first frame, so the body above is
      // never drawn and this ring is the *only* mark of the knockout: stroked in
      // `neutral` it is the same colour as the arena lip and says nothing about
      // who went off. Same lookup `drawPlayer` uses for the falling body; the
      // victim can be absent from the player list on a forfeit, and then there is
      // no side to speak for and the neutral mark is the honest one.
      const dustSide = view.players.find(player => player.sessionId === frame.sessionId)?.side;
      ctx.globalAlpha = frame.puffOpacity;
      ctx.strokeStyle = dustSide === undefined ? neutral : dustSide === 0 ? primary : danger;
      ctx.lineWidth = line(100);
      ctx.beginPath();
      ctx.arc(dust.x, dust.y, frame.puffRadius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const projectile of view.projectiles) {
      const projectilePoint = point(projectile);
      const projectileColor = view.players.find(player => player.sessionId === projectile.ownerSessionId)?.side === 1 ? danger : primary;
      if (!options.reducedMotion) {
        ctx.strokeStyle = projectileColor;
        ctx.lineWidth = line(100);
        ctx.beginPath();
        ctx.moveTo(projectilePoint.x, projectilePoint.y);
        ctx.lineTo(projectilePoint.x - projectile.vx * scale * 3, projectilePoint.y - projectile.vy * scale * 3);
        ctx.stroke();
      }
      ctx.fillStyle = projectileColor;
      ctx.beginPath();
      ctx.arc(projectilePoint.x, projectilePoint.y, projectileRadius * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = text;
      ctx.lineWidth = line(45);
      ctx.stroke();
      const owner = view.players.find(player => player.sessionId === projectile.ownerSessionId);
      const markerDirection = owner?.side === 1 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(projectilePoint.x, projectilePoint.y - projectileRadius * scale);
      ctx.lineTo(projectilePoint.x + markerDirection * projectileRadius * scale, projectilePoint.y);
      ctx.stroke();
    }

    for (const player of view.players) {
      // A victim is drawn above, at its animated position and under the lip. Its
      // authoritative position is already back at spawn, so drawing it here too
      // would put a second copy of the same player on the board.
      if (falling.has(player.sessionId)) continue;
      this.drawPlayer(ctx, player, view, { primary, danger, neutral, text }, scale, line, point);
    }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.observer?.disconnect();
    this.observer = null;
    for (const avatar of this.avatars.values()) {
      avatar.image.onload = null;
      avatar.image.onerror = null;
    }
    this.avatars.clear();
    this.fallback.onload = null;
    this.fallback.onerror = null;
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: ArenaPlayerSnapshot,
    view: ArenaRenderView,
    colors: { primary: string; danger: string; neutral: string; text: string },
    scale: number,
    line: (worldWidth: number) => number,
    point: (value: FixedVec) => FixedVec,
    frame?: ArenaKnockoutFrame,
  ) {
    const body = point(frame ?? player);
    const { playerRadius: fullRadius, shotCooldownTicks } = view.prediction;
    const playerRadius = frame === undefined ? fullRadius : fullRadius * frame.scale;
    const sideColor = player.side === 0 ? colors.primary : colors.danger;
    const aimLength = Math.hypot(player.aimX, player.aimY) || 1;
    const aimX = player.aimX / aimLength;
    const aimY = player.aimY / aimLength;

    // A falling body keeps only its silhouette: the aim and charge sticks, the
    // rear marker, the name and the local cooldown and dash cues all describe a
    // player who is still in the round, and this one is not.
    if (frame !== undefined) {
      ctx.globalAlpha = frame.scale;
      this.drawBody(ctx, player, view, body, playerRadius, scale, sideColor, colors.text, line);
      ctx.globalAlpha = 1;
      return;
    }

    ctx.strokeStyle = colors.neutral;
    ctx.lineWidth = line(45);
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(body.x + aimX * AIM_LENGTH * scale, body.y + aimY * AIM_LENGTH * scale);
    ctx.stroke();

    if (player.chargePermille > 0) {
      const chargeLength = CHARGE_LENGTH * Math.min(1000, player.chargePermille) / 1000;
      ctx.strokeStyle = sideColor;
      ctx.lineWidth = line(90 + player.chargePermille / 5);
      ctx.setLineDash([line(220), line(100)]);
      ctx.beginPath();
      ctx.moveTo(body.x, body.y);
      const endX = body.x + aimX * chargeLength * scale;
      const endY = body.y + aimY * chargeLength * scale;
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Refusing a short charge is silent by design, so the gate has to be visible or
      // the first few taps read as a broken game. Only while the shot would still be
      // refused, and only for the player whose shot it is.
      const minimumPermille = Math.min(1000, Math.floor(
        view.prediction.minChargeTicks * 1000 / view.prediction.chargeTicks,
      ));
      if (player.sessionId === view.selfSessionId && player.chargePermille < minimumPermille) {
        const gate = CHARGE_LENGTH * minimumPermille / 1000 * scale;
        const half = line(260);
        ctx.strokeStyle = colors.neutral;
        ctx.lineWidth = line(45);
        ctx.beginPath();
        ctx.moveTo(body.x + aimX * gate - aimY * half, body.y + aimY * gate + aimX * half);
        ctx.lineTo(body.x + aimX * gate + aimY * half, body.y + aimY * gate - aimX * half);
        ctx.stroke();
      }
      if (player.forcedFireTicks !== null) {
        ctx.fillStyle = colors.text;
        const style = getComputedStyle(this.canvas);
        ctx.font = `${style.getPropertyValue('--text-xs')} ${style.getPropertyValue('--font-mono')}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(player.forcedFireTicks), endX, endY - line(180));
      }
    }

    this.drawBody(ctx, player, view, body, playerRadius, scale, sideColor, colors.text, line);

    ctx.fillStyle = colors.text;
    const style = getComputedStyle(this.canvas);
    ctx.font = `${style.getPropertyValue('--text-sm')} ${style.getPropertyValue('--font-body')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(view.names[player.sessionId] || String(player.sessionId), body.x, body.y + (playerRadius + 180) * scale);

    if (player.sessionId !== view.selfSessionId) return;
    if (player.cooldownTicks > 0) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = line(90);
      ctx.beginPath();
      ctx.arc(body.x, body.y, (playerRadius + 180) * scale, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (1 - player.cooldownTicks / shotCooldownTicks));
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(String(player.cooldownTicks), body.x, body.y);
    }
    if (player.dashAvailable) {
      ctx.fillStyle = sideColor;
      ctx.textBaseline = 'bottom';
      ctx.fillText('DASH', body.x, body.y - (playerRadius + 180) * scale);
    }
  }

  /** The avatar disc, its side outline and the local player's inner ring. */
  private drawBody(
    ctx: CanvasRenderingContext2D,
    player: ArenaPlayerSnapshot,
    view: ArenaRenderView,
    body: FixedVec,
    playerRadius: number,
    scale: number,
    sideColor: string,
    text: string,
    line: (worldWidth: number) => number,
  ) {
    const avatar = this.avatarFor(player.sessionId, view.avatarUrls[player.sessionId]);
    const rear = rearVector(player);
    ctx.save();
    this.bodyPath(ctx, body, playerRadius * scale, rear);
    ctx.clip();
    const diameter = playerRadius * scale * 2;
    if (avatar?.complete && avatar.naturalWidth > 0) {
      ctx.drawImage(avatar, body.x - diameter / 2, body.y - diameter / 2, diameter, diameter);
    } else {
      this.drawFallback(ctx, body, diameter, sideColor, text);
    }
    ctx.restore();

    ctx.strokeStyle = sideColor;
    ctx.lineWidth = line(player.side === 0 ? 100 : 140);
    this.bodyPath(ctx, body, playerRadius * scale, rear);
    ctx.stroke();
    if (player.side === 0) {
      ctx.lineWidth = line(45);
      this.bodyPath(ctx, body, Math.max(0, playerRadius - 150) * scale, rear);
      ctx.stroke();
    }
  }

  // The body is a disc with a wedge cut out of its rear, which reads as the
  // player's back and turns with the aim. Every ring of the body shares this path:
  // a full-circle outline would paint straight back over the carved fill.
  private bodyPath(
    ctx: CanvasRenderingContext2D,
    body: FixedVec,
    radius: number,
    rear: { x: number; y: number },
  ) {
    const angle = Math.atan2(rear.y, rear.x);
    ctx.beginPath();
    // Sweep the long way round from one lip of the notch to the other, then close
    // through the vertex so the wedge is absent from the path rather than drawn.
    ctx.arc(body.x, body.y, radius, angle + NOTCH_HALF_ANGLE, angle - NOTCH_HALF_ANGLE + Math.PI * 2);
    const depth = radius * (1 - NOTCH_DEPTH);
    ctx.lineTo(body.x + rear.x * depth, body.y + rear.y * depth);
    ctx.closePath();
  }

  private drawFallback(ctx: CanvasRenderingContext2D, body: FixedVec, diameter: number, fill: string, text: string) {
    ctx.fillStyle = fill;
    ctx.fillRect(body.x - diameter / 2, body.y - diameter / 2, diameter, diameter);
    ctx.fillStyle = text;
    const style = getComputedStyle(this.canvas);
    ctx.font = `${style.getPropertyValue('--text-sm')} ${style.getPropertyValue('--font-display')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', body.x, body.y);
  }

  private avatarFor(sessionId: number, requested: string | null | undefined): HTMLImageElement | null {
    const source = requested || FALLBACK_AVATAR_SRC;
    const existing = this.avatars.get(sessionId);
    if (existing?.source === source) return existing.ready ? existing.image : this.loadedFallback();
    if (existing) {
      existing.image.onload = null;
      existing.image.onerror = null;
    }
    if (!requested) return this.loadedFallback();
    const generation = ++this.generation;
    const image = this.makeImage(source, false);
    const entry: AvatarEntry = { image, source, ready: false, generation };
    image.onload = () => {
      if (!this.disposed && this.avatars.get(sessionId)?.generation === generation) entry.ready = true;
    };
    image.onerror = () => {
      if (this.avatars.get(sessionId)?.generation === generation) entry.ready = false;
      image.onload = null;
      image.onerror = null;
    };
    this.avatars.set(sessionId, entry);
    return this.loadedFallback();
  }

  private loadedFallback(): HTMLImageElement | null {
    return this.fallback.complete && this.fallback.naturalWidth > 0 ? this.fallback : null;
  }

  private makeImage(source: string, ready: boolean): HTMLImageElement {
    const image = new Image();
    image.src = source;
    if (ready) image.onload = null;
    return image;
  }
}
