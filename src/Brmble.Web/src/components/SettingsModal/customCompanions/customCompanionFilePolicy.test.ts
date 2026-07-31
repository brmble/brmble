import { describe, expect, it } from 'vitest';
import { getSupportedCompanionMime } from './customCompanionFilePolicy';

describe('getSupportedCompanionMime', () => {
  it.each([
    ['sprite.png', 'image/png', 'image/png'],
    ['sprite.WEBP', 'image/webp', 'image/webp'],
    ['sprite.PNG', '', 'image/png'],
    ['sprite.jpg', 'image/jpeg', null],
    ['sprite', '', null],
    ['sprite.png', 'image/webp', null],
  ])('checks filename %s and browser MIME %s', (name, type, expected) => {
    expect(getSupportedCompanionMime(new File(['bytes'], name, { type }))).toBe(expected);
  });

  it('normalizes a matching browser MIME type before comparing it', () => {
    expect(getSupportedCompanionMime(new File(['bytes'], 'sprite.webp', {
      type: ' IMAGE/WEBP ',
    }))).toBe('image/webp');
  });
});
