import { describe, expect, it } from 'vitest';
import {
  emptyGallery,
  parseCustomCompanionEvent,
  reduceGalleryEvent,
  type CustomCompanionCapability,
  type CustomCompanionEvent,
} from './customCompanionTypes';

const capability: CustomCompanionCapability = {
  enabled: true,
  schemaVersion: 1,
  galleryRoomId: '!gallery:test',
  trustedSender: '@brmble:test',
  canModerate: false,
  selectedCompanionId: 'floppy',
  maxActivePerUser: 10,
  maxActiveTotal: 100,
};

const spriteEvent: CustomCompanionEvent = {
  type: 'im.brmble.sprite',
  eventId: '$sprite:test',
  roomId: '!gallery:test',
  sender: '@brmble:test',
  createdAt: 1234,
  content: {
    schemaVersion: 1,
    name: 'Orbit',
    mediaUri: 'mxc://test/orbit',
    mimeType: 'image/png',
    width: 800,
    height: 900,
    frameCount: 1,
    byteSize: 4096,
    uploaderMatrixUserId: '@alice:test',
    uploaderDisplayName: 'Alice',
  },
};

describe('parseCustomCompanionEvent', () => {
  it('accepts only schema-1 bot events from the advertised room', () => {
    const parsed = parseCustomCompanionEvent(spriteEvent, capability);
    expect(parsed).toMatchObject({
      id: 'custom:$sprite:test',
      eventId: '$sprite:test',
      name: 'Orbit',
      uploaderDisplayName: 'Alice',
      atlasCacheKey: '!gallery:test\u0000$sprite:test',
    });
    expect(parseCustomCompanionEvent({ ...spriteEvent, sender: '@mallory:test' }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({ ...spriteEvent, roomId: '!other:test' }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({
      ...spriteEvent,
      content: { ...spriteEvent.content, mimeType: 'image/jpeg' },
    }, capability)).toBeNull();
  });

  it('requires server-derived dimensions and a single frame', () => {
    expect(parseCustomCompanionEvent(spriteEvent, capability)).toMatchObject({
      mimeType: 'image/png',
      width: 800,
      height: 900,
      frameCount: 1,
    });

    for (const content of [
      { ...spriteEvent.content, width: 0 },
      { ...spriteEvent.content, width: 4097 },
      { ...spriteEvent.content, height: 4097 },
      { ...spriteEvent.content, width: 4000, height: 3001 },
      { ...spriteEvent.content, frameCount: 2 },
      { ...spriteEvent.content, byteSize: -1 },
      { ...spriteEvent.content, byteSize: 1.5 },
    ]) {
      expect(parseCustomCompanionEvent({ ...spriteEvent, content }, capability)).toBeNull();
    }
  });

  it('rejects malformed, redacted, legacy, and unsupported events', () => {
    expect(parseCustomCompanionEvent({ ...spriteEvent, eventId: 'not-matrix' }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({ ...spriteEvent, content: {} }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({
      ...spriteEvent,
      content: { ...spriteEvent.content, schemaVersion: 2 },
    }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({ ...spriteEvent, redacted: true }, capability)).toBeNull();
    expect(parseCustomCompanionEvent({ ...spriteEvent, type: 'm.room.message' }, capability)).toBeNull();
  });
});

describe('reduceGalleryEvent', () => {
  const entry = parseCustomCompanionEvent(spriteEvent, capability)!;

  it('deduplicates additions and applies redaction-before-addition', () => {
    const removed = reduceGalleryEvent(emptyGallery(), { kind: 'remove', eventId: '$sprite:test' });
    const final = reduceGalleryEvent(removed, { kind: 'upsert', entry });
    expect(final.entries).toEqual([]);
    expect(final.redactedEventIds).toContain('$sprite:test');
  });

  it('sorts newest first with event ID as a stable tie-breaker', () => {
    const gallery = [
      { ...entry, eventId: '$z:test', id: 'custom:$z:test' as const, createdAt: 2000 },
      { ...entry, eventId: '$b:test', id: 'custom:$b:test' as const, createdAt: 3000 },
      { ...entry, eventId: '$a:test', id: 'custom:$a:test' as const, createdAt: 3000 },
    ].reduce(
      (state, next) => reduceGalleryEvent(state, { kind: 'upsert', entry: next }),
      emptyGallery(),
    );

    expect(gallery.entries.map(item => item.eventId)).toEqual(['$a:test', '$b:test', '$z:test']);
    expect(reduceGalleryEvent(gallery, { kind: 'upsert', entry }).entries.filter(item => item.eventId === entry.eventId)).toHaveLength(1);
  });
});
