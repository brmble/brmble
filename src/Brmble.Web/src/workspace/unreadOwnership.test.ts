import { describe, expect, it } from 'vitest';
import { suppressOpenConversations } from './unreadOwnership';

describe('suppressOpenConversations', () => {
  const keyOf = (id: string) => `channel:${id}`;

  it('removes entries whose conversation is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3], ['9', 1]]), new Set(['channel:7']), keyOf);
    expect([...result.keys()]).toEqual(['9']);
  });

  it('leaves everything when nothing is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3]]), new Set<string>(), keyOf);
    expect([...result.keys()]).toEqual(['7']);
  });

  it('does not mutate the input', () => {
    const input = new Map([['7', 3]]);
    suppressOpenConversations(input, new Set(['channel:7']), keyOf);
    expect(input.size).toBe(1);
  });

  it('returns an empty map when every conversation is open', () => {
    const result = suppressOpenConversations(new Map([['7', 3]]), new Set(['channel:7']), keyOf);
    expect(result.size).toBe(0);
  });
});
