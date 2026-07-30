import { describe, expect, it } from 'vitest';
import {
  normalizeCompanionBridgeSelection,
  resolveCompanionDisplay,
} from './components/SettingsModal/InterfaceSettingsTypes';

const entry = {
  id: 'custom:$sprite:test' as const,
  eventId: '$sprite:test',
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

function gallery(input?: {
  entries?: typeof entry[];
  ready?: string[];
  redacted?: string[];
}) {
  return {
    status: 'ready',
    entries: input?.entries ?? [entry],
    readyAtlasCacheKeys: new Set(input?.ready ?? [entry.atlasCacheKey]),
    redactedEventIds: new Set(input?.redacted ?? []),
  };
}

describe('App custom companion delivery', () => {
  it('immediately falls back local and remote displays when the selected event is removed', () => {
    const available = gallery();
    const removed = gallery({ entries: [], ready: [], redacted: [entry.eventId] });

    expect(resolveCompanionDisplay(entry.id, available).companionId).toBe(entry.id);
    expect(resolveCompanionDisplay(entry.id, available).companionId).toBe(entry.id);
    expect(resolveCompanionDisplay(entry.id, removed).companionId).toBe('floppy');
    expect(resolveCompanionDisplay(entry.id, removed).companionId).toBe('floppy');
  });

  it('restores a temporarily unavailable selection after its atlas becomes ready', () => {
    const unavailable = gallery({ ready: [] });
    const recovered = gallery();

    expect(resolveCompanionDisplay(entry.id, unavailable).companionId).toBe('floppy');
    expect(resolveCompanionDisplay(entry.id, recovered)).toEqual({
      companionId: entry.id,
      atlasCacheKey: entry.atlasCacheKey,
    });
  });

  it('keeps a redacted selection on floppy even if stale metadata and cache state reappear', () => {
    const redacted = gallery({ redacted: [entry.eventId] });

    expect(resolveCompanionDisplay(entry.id, redacted).companionId).toBe('floppy');
  });

  it('prefers the additive custom field while preserving the legacy floppy field', () => {
    const serverPayload = {
      companionId: 'floppy',
      customCompanionId: 'custom:$sprite:test',
    };

    expect(serverPayload.companionId).toBe('floppy');
    expect(normalizeCompanionBridgeSelection(serverPayload)).toBe('custom:$sprite:test');
  });
});
