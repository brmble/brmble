import brmbleLogo from '../../../assets/brmble-logo.svg';
import type { ArenaPlayerSnapshot, ArenaProjectileSnapshot, ArenaStateSnapshot } from './arenaProtocol';
import { computeLayout, screenToWorld, worldToScreen, type ArenaLayout, type FixedVec } from './arenaMath';

export const FALLBACK_AVATAR_SRC = brmbleLogo;

export interface ArenaRenderView {
  selfSessionId: number;
  players: ArenaPlayerSnapshot[];
  projectiles: ArenaProjectileSnapshot[];
  arena: ArenaStateSnapshot['arena'];
  names: Record<number, string>;
  avatarUrls: Record<number, string | null | undefined>;
}

interface AvatarEntry {
  image: HTMLImageElement;
  source: string;
  ready: boolean;
  generation: number;
}

const WORLD_SIZE = 20_000;
const BODY_RADIUS = 600;
const PROJECTILE_RADIUS = 180;
const CHARGE_LENGTH = 2_200;
const AIM_LENGTH = 3_000;
const SHOT_COOLDOWN_TICKS = 24;

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
    const style = getComputedStyle(this.canvas);
    const color = (token: string) => style.getPropertyValue(token).trim();
    const primary = color('--accent-primary');
    const danger = color('--accent-danger');
    const neutral = color('--text-muted');
    const text = color('--text-primary');
    const surface = color('--bg-surface');
    const scale = this.layout.size / WORLD_SIZE;
    const line = (worldWidth: number) => Math.max(1, worldWidth * scale);
    const point = (value: FixedVec) => worldToScreen(value, this.layout);

    ctx.clearRect(0, 0, this.layout.cssWidth, this.layout.cssHeight);
    ctx.fillStyle = surface;
    ctx.fillRect(this.layout.offsetX, this.layout.offsetY, this.layout.size, this.layout.size);

    const center = point({ x: 0, y: 0 });
    ctx.strokeStyle = view.arena.shrinkPhase === 'collapse' ? danger : neutral;
    ctx.lineWidth = line(view.arena.shrinkPhase === 'hold' ? 60 : 100);
    ctx.beginPath();
    ctx.arc(center.x, center.y, view.arena.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.font = `${color('--text-xs')} ${color('--font-mono')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(view.arena.shrinkPhase.toUpperCase(), center.x, this.layout.offsetY + line(420));

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
      ctx.arc(projectilePoint.x, projectilePoint.y, PROJECTILE_RADIUS * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = text;
      ctx.lineWidth = line(45);
      ctx.stroke();
      const owner = view.players.find(player => player.sessionId === projectile.ownerSessionId);
      const markerDirection = owner?.side === 1 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(projectilePoint.x, projectilePoint.y - PROJECTILE_RADIUS * scale);
      ctx.lineTo(projectilePoint.x + markerDirection * PROJECTILE_RADIUS * scale, projectilePoint.y);
      ctx.stroke();
    }

    for (const player of view.players) this.drawPlayer(ctx, player, view, { primary, danger, neutral, text }, scale, line, point);
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
  ) {
    const body = point(player);
    const sideColor = player.side === 0 ? colors.primary : colors.danger;
    const aimLength = Math.hypot(player.aimX, player.aimY) || 1;
    const aimX = player.aimX / aimLength;
    const aimY = player.aimY / aimLength;

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
      if (player.forcedFireTicks !== null) {
        ctx.fillStyle = colors.text;
        const style = getComputedStyle(this.canvas);
        ctx.font = `${style.getPropertyValue('--text-xs')} ${style.getPropertyValue('--font-mono')}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(player.forcedFireTicks), endX, endY - line(180));
      }
    }

    const avatar = this.avatarFor(player.sessionId, view.avatarUrls[player.sessionId]);
    ctx.save();
    ctx.beginPath();
    ctx.arc(body.x, body.y, BODY_RADIUS * scale, 0, Math.PI * 2);
    ctx.clip();
    const diameter = BODY_RADIUS * scale * 2;
    if (avatar?.complete && avatar.naturalWidth > 0) {
      ctx.drawImage(avatar, body.x - diameter / 2, body.y - diameter / 2, diameter, diameter);
    } else {
      this.drawFallback(ctx, body, diameter, sideColor, colors.text);
    }
    ctx.restore();

    ctx.strokeStyle = sideColor;
    ctx.lineWidth = line(player.side === 0 ? 100 : 140);
    ctx.beginPath();
    ctx.arc(body.x, body.y, BODY_RADIUS * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (player.side === 0) {
      ctx.lineWidth = line(45);
      ctx.beginPath();
      ctx.arc(body.x, body.y, (BODY_RADIUS - 150) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = sideColor;
    ctx.beginPath();
    const direction = player.side === 0 ? -1 : 1;
    ctx.moveTo(body.x + direction * BODY_RADIUS * scale, body.y - line(180));
    ctx.lineTo(body.x + direction * (BODY_RADIUS + 300) * scale, body.y);
    ctx.lineTo(body.x + direction * BODY_RADIUS * scale, body.y + line(180));
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = colors.text;
    const style = getComputedStyle(this.canvas);
    ctx.font = `${style.getPropertyValue('--text-sm')} ${style.getPropertyValue('--font-body')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(view.names[player.sessionId] || String(player.sessionId), body.x, body.y + (BODY_RADIUS + 180) * scale);

    if (player.sessionId !== view.selfSessionId) return;
    if (player.cooldownTicks > 0) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = line(90);
      ctx.beginPath();
      ctx.arc(body.x, body.y, (BODY_RADIUS + 180) * scale, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (1 - player.cooldownTicks / SHOT_COOLDOWN_TICKS));
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(String(player.cooldownTicks), body.x, body.y);
    }
    if (player.dashAvailable) {
      ctx.fillStyle = sideColor;
      ctx.textBaseline = 'bottom';
      ctx.fillText('DASH', body.x, body.y - (BODY_RADIUS + 180) * scale);
    }
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
