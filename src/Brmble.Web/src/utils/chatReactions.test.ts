import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_REACTIONS,
  addReactionSender,
  hasReactionFromSender,
  removeReactionSender,
} from './chatReactions';

describe('chatReactions', () => {
  it('exposes the six supported reaction emojis in menu order', () => {
    expect(SUPPORTED_REACTIONS).toEqual(['👍', '❤️', '😂', '😮', '😢', '😡']);
  });

  it('adds a sender without mutating the previous reaction map', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = addReactionSender(previous, '👍', '@bob:example.com');

    expect(next).toEqual({ '👍': ['@alice:example.com', '@bob:example.com'] });
    expect(previous).toEqual({ '👍': ['@alice:example.com'] });
  });

  it('does not duplicate the same sender for the same emoji', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = addReactionSender(previous, '👍', '@alice:example.com');

    expect(next).toBe(previous);
  });

  it('removes a sender and prunes empty emoji entries', () => {
    const previous = {
      '👍': ['@alice:example.com'],
      '😂': ['@alice:example.com', '@bob:example.com'],
    };

    const next = removeReactionSender(previous, '👍', '@alice:example.com');
    const second = removeReactionSender(next, '😂', '@alice:example.com');

    expect(next).toEqual({ '😂': ['@alice:example.com', '@bob:example.com'] });
    expect(second).toEqual({ '😂': ['@bob:example.com'] });
  });

  it('returns the previous map when removing a missing sender', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = removeReactionSender(previous, '👍', '@bob:example.com');

    expect(next).toBe(previous);
  });

  it('detects whether a sender already reacted with an emoji', () => {
    expect(hasReactionFromSender({ '👍': ['@alice:example.com'] }, '👍', '@alice:example.com')).toBe(true);
    expect(hasReactionFromSender({ '👍': ['@alice:example.com'] }, '👍', '@bob:example.com')).toBe(false);
    expect(hasReactionFromSender(undefined, '👍', '@alice:example.com')).toBe(false);
  });
});
