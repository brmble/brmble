import { describe, expect, it } from 'vitest';
import { canDeleteMessage } from './messageDeletion';

const NOW = Date.parse('2026-08-06T12:00:00Z');
const WINDOW = 86_400_000;

function message(senderMatrixUserId: string, ageMs: number, redacted = false) {
  return {
    id: '$message:test', channelId: '42', sender: 'Alice', content: 'hello',
    senderMatrixUserId, timestamp: new Date(NOW - ageMs), redacted,
  };
}

describe('canDeleteMessage', () => {
  it('allows the author one millisecond inside the window', () => {
    expect(canDeleteMessage(message('@alice:test', WINDOW - 1), '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(true);
  });

  it('rejects the author at exactly twenty-four hours', () => {
    expect(canDeleteMessage(message('@alice:test', WINDOW), '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(false);
  });

  it('allows an administrator to target another author', () => {
    expect(canDeleteMessage(message('@bob:test', 1_000), '!general:test', '@alice:test', true, WINDOW, NOW)).toBe(true);
  });

  it('allows a bridged author using the effective sender ID', () => {
    expect(canDeleteMessage(message('@alice:test', 1_000), '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(true);
  });

  it('rejects another user and a redacted message', () => {
    expect(canDeleteMessage(message('@bob:test', 1_000), '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(false);
    expect(canDeleteMessage(message('@alice:test', 1_000, true), '!general:test', '@alice:test', true, WINDOW, NOW)).toBe(false);
  });

  it.each([
    ['missing Matrix room', message('@alice:test', 1_000), null],
    ['temporary id', { ...message('@alice:test', 1_000), id: 'temp-1' }, '!general:test'],
    ['pending', { ...message('@alice:test', 1_000), pending: true }, '!general:test'],
    ['failed', { ...message('@alice:test', 1_000), error: true }, '!general:test'],
    ['system', { ...message('@alice:test', 1_000), type: 'system' as const }, '!general:test'],
    ['game', { ...message('@alice:test', 1_000), gameType: 'deathroll' }, '!general:test'],
  ])('rejects %s messages', (_label, candidate, roomId) => {
    expect(canDeleteMessage(candidate, roomId, '@alice:test', true, WINDOW, NOW)).toBe(false);
  });

  it('rejects invalid and future timestamps', () => {
    expect(canDeleteMessage({ ...message('@alice:test', 1_000), timestamp: new Date(Number.NaN) }, '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(false);
    expect(canDeleteMessage(message('@alice:test', -1), '!general:test', '@alice:test', false, WINDOW, NOW)).toBe(false);
  });
});
