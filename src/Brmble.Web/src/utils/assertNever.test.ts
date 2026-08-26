import { describe, expect, it } from 'vitest';
import { assertNever } from './assertNever';

describe('assertNever', () => {
  it('throws with the unhandled value, so a missed union member fails loudly at runtime too', () => {
    expect(() => assertNever('spectate' as never)).toThrow(/spectate/);
  });
});
