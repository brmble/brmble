import type { CompanionSelection } from '../components/SettingsModal/InterfaceSettingsTypes';

export interface CustomCompanionCapability {
  enabled: true;
  schemaVersion: 1;
  galleryRoomId: string;
  trustedSender: string;
  canModerate: boolean;
  selectedCompanionId: CompanionSelection;
  maxActivePerUser: number;
  maxActiveTotal: number;
}

export interface CustomCompanionEntry {
  id: `custom:${string}`;
  eventId: string;
  roomId: string;
  name: string;
  mediaUri: string;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
  frameCount: 1;
  byteSize: number;
  uploaderMatrixUserId: string;
  uploaderDisplayName: string;
  createdAt: number;
  atlasCacheKey: string;
}

export type CustomCompanionGalleryStatus =
  | 'disabled'
  | 'loading'
  | 'empty'
  | 'unavailable'
  | 'ready';

export interface CustomCompanionGallery {
  status: CustomCompanionGalleryStatus;
  entries: CustomCompanionEntry[];
  redactedEventIds: Set<string>;
  error: string | null;
}

interface CustomCompanionEventContent {
  schemaVersion?: unknown;
  name?: unknown;
  mediaUri?: unknown;
  mimeType?: unknown;
  width?: unknown;
  height?: unknown;
  frameCount?: unknown;
  byteSize?: unknown;
  uploaderMatrixUserId?: unknown;
  uploaderDisplayName?: unknown;
}

export interface CustomCompanionEvent {
  type: string;
  eventId: string;
  roomId: string;
  sender: string;
  createdAt: number;
  content: CustomCompanionEventContent;
  redacted?: boolean;
}

interface MatrixEventLike {
  getType(): string;
  getId(): string | undefined;
  getRoomId(): string | undefined;
  getSender(): string | undefined;
  getTs(): number;
  getContent(): CustomCompanionEventContent;
  isRedacted?(): boolean;
}

export type GalleryEvent =
  | { kind: 'upsert'; entry: CustomCompanionEntry }
  | { kind: 'remove'; eventId: string };

function isMatrixEventLike(event: CustomCompanionEvent | MatrixEventLike): event is MatrixEventLike {
  return typeof (event as Partial<MatrixEventLike>).getType === 'function';
}

function normalizeEvent(event: CustomCompanionEvent | MatrixEventLike): CustomCompanionEvent | null {
  if (!isMatrixEventLike(event)) return event;
  const eventId = event.getId();
  const roomId = event.getRoomId();
  const sender = event.getSender();
  if (!eventId || !roomId || !sender) return null;
  return {
    type: event.getType(),
    eventId,
    roomId,
    sender,
    createdAt: event.getTs(),
    content: event.getContent(),
    redacted: event.isRedacted?.() ?? false,
  };
}

function isRequiredString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 4096;
}

function isMatrixEventId(value: string): boolean {
  const hasControlCharacter = Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  return value.length >= 2 && value.startsWith('$') && !hasControlCharacter;
}

export function parseCustomCompanionEvent(
  source: CustomCompanionEvent | MatrixEventLike,
  capability: CustomCompanionCapability,
): CustomCompanionEntry | null {
  const event = normalizeEvent(source);
  if (!event
    || capability.enabled !== true
    || capability.schemaVersion !== 1
    || event.type !== 'im.brmble.sprite'
    || event.roomId !== capability.galleryRoomId
    || event.sender !== capability.trustedSender
    || event.redacted
    || !isMatrixEventId(event.eventId)
    || !Number.isFinite(event.createdAt)
    || event.createdAt < 0) {
    return null;
  }

  const content = event.content;
  if (content.schemaVersion !== 1
    || !isRequiredString(content.name)
    || !isRequiredString(content.mediaUri)
    || (content.mimeType !== 'image/png' && content.mimeType !== 'image/webp')
    || !isDimension(content.width)
    || !isDimension(content.height)
    || content.width * content.height > 12_000_000
    || content.frameCount !== 1
    || !Number.isInteger(content.byteSize)
    || (content.byteSize as number) < 0
    || !isRequiredString(content.uploaderMatrixUserId)
    || !isRequiredString(content.uploaderDisplayName)) {
    return null;
  }

  return {
    id: `custom:${event.eventId}`,
    eventId: event.eventId,
    roomId: event.roomId,
    name: content.name,
    mediaUri: content.mediaUri,
    mimeType: content.mimeType,
    width: content.width,
    height: content.height,
    frameCount: 1,
    byteSize: content.byteSize as number,
    uploaderMatrixUserId: content.uploaderMatrixUserId,
    uploaderDisplayName: content.uploaderDisplayName,
    createdAt: event.createdAt,
    atlasCacheKey: `${event.roomId}\u0000${event.eventId}`,
  };
}

export function emptyGallery(
  status: CustomCompanionGalleryStatus = 'loading',
  redactedEventIds = new Set<string>(),
): CustomCompanionGallery {
  return { status, entries: [], redactedEventIds, error: null };
}

function withDerivedStatus(gallery: CustomCompanionGallery): CustomCompanionGallery {
  return {
    ...gallery,
    status: gallery.entries.length === 0 ? 'empty' : 'ready',
    error: null,
  };
}

export function reduceGalleryEvent(
  gallery: CustomCompanionGallery,
  event: GalleryEvent,
): CustomCompanionGallery {
  if (event.kind === 'remove') {
    const redactedEventIds = new Set(gallery.redactedEventIds);
    redactedEventIds.add(event.eventId);
    return withDerivedStatus({
      ...gallery,
      entries: gallery.entries.filter(entry => entry.eventId !== event.eventId),
      redactedEventIds,
    });
  }

  if (gallery.redactedEventIds.has(event.entry.eventId)) return gallery;
  const entries = gallery.entries
    .filter(entry => entry.eventId !== event.entry.eventId)
    .concat(event.entry)
    .sort((left, right) => (right.createdAt - left.createdAt) || left.eventId.localeCompare(right.eventId));
  return withDerivedStatus({ ...gallery, entries });
}
