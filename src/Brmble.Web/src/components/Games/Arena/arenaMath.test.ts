import { describe, expect, it } from 'vitest';
import { arenaRadius, damp, knockback, movePerTick, normalizeQ15, recoil } from './arenaMath';

describe('arenaMath golden vectors', () => {
  it.each([
    [32767, 32767, 23170, 23170],
    [-32767, 32767, -23170, 23170],
    [32767, 0, 32767, 0],
    [0, 0, 0, 0],
  ])('normalizeQ15(%i,%i)', (x, y, ex, ey) =>
    expect(normalizeQ15(x, y)).toEqual({ x: ex, y: ey }));

  it('curves at q=333', () => {
    expect(movePerTick(333)).toBe(76);
    expect(knockback(333)).toBe(203);
    expect(recoil(333)).toBe(79);
  });

  it('damps toward zero on both signs', () =>
    expect(damp({ x: 350, y: -151 })).toEqual({ x: 322, y: -138 }));

  it.each([
    [599, 9000],
    [600, 8997],
    [2399, 3500],
    [2400, 3498],
    [3599, 0],
    [3600, 0],
  ])('arenaRadius(%i)', (tick, radius) => expect(arenaRadius(tick)).toBe(radius));
});
