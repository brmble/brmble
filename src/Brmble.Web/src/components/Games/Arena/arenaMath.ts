export interface FixedVec {
  x: number;
  y: number;
}

const Q15_MAX = 32_767n;
const PERMILLE = 1_000n;

function checkedNumber(value: bigint): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Fixed-point result exceeds the safe integer range');
  }

  return Number(value);
}

function multiplyDivide(value: number, multiplier: number, divisor: number): number {
  return checkedNumber((BigInt(value) * BigInt(multiplier)) / BigInt(divisor));
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new RangeError('Integer square root requires a non-negative value');
  }

  let remainder = value;
  let result = 0n;
  let bit = 1n;

  while (bit <= (remainder >> 2n)) {
    bit <<= 2n;
  }

  while (bit !== 0n) {
    if (remainder >= result + bit) {
      remainder -= result + bit;
      result = (result >> 1n) + bit;
    } else {
      result >>= 1n;
    }

    bit >>= 2n;
  }

  return result;
}

export function normalizeQ15(x: number, y: number): FixedVec {
  if (x === 0 && y === 0) {
    return { x: 0, y: 0 };
  }

  const bigX = BigInt(x);
  const bigY = BigInt(y);
  const length = integerSqrt(bigX * bigX + bigY * bigY);
  if (length <= Q15_MAX) {
    return { x, y };
  }

  return {
    x: checkedNumber((bigX * Q15_MAX) / length),
    y: checkedNumber((bigY * Q15_MAX) / length),
  };
}

export function scale(vector: FixedVec, amount: number): FixedVec {
  return {
    x: multiplyDivide(vector.x, amount, 32_767),
    y: multiplyDivide(vector.y, amount, 32_767),
  };
}

export function movePerTick(q: number): number {
  return 90 - multiplyDivide(45, Math.min(1000, Math.max(0, q)), 1000);
}

export function knockback(q: number): number {
  return 130 + multiplyDivide(220, Math.min(1000, Math.max(0, q)), 1000);
}

export function recoil(q: number): number {
  return 45 + multiplyDivide(105, Math.min(1000, Math.max(0, q)), 1000);
}

export function chargePermille(chargeTicks: number): number {
  const clampedTicks = Math.min(90, Math.max(0, chargeTicks));
  return Math.min(1000, multiplyDivide(clampedTicks, 1000, 90));
}

export function arenaRadius(liveTick: number): number {
  if (liveTick < 600) {
    return 9_000;
  }
  if (liveTick < 2_400) {
    return 9_000 - multiplyDivide(5_500, liveTick - 599, 1_800);
  }
  if (liveTick < 3_600) {
    return 3_500 - multiplyDivide(3_500, liveTick - 2_399, 1_200);
  }
  return 0;
}

export function damp(vector: FixedVec): FixedVec {
  return {
    x: checkedNumber((BigInt(vector.x) * 920n) / PERMILLE),
    y: checkedNumber((BigInt(vector.y) * 920n) / PERMILLE),
  };
}
