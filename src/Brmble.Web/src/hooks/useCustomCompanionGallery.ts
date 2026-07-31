import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClientEvent,
  RoomEvent,
  RoomStateEvent,
  SyncState,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import bridge from '../bridge';
import { deleteAtlas } from '../customCompanions/customCompanionAtlasStore';
import { CustomCompanionMediaLoader } from '../customCompanions/customCompanionMediaLoader';
import {
  emptyGallery,
  parseCustomCompanionEvent,
  reduceGalleryEvent,
  type CustomCompanionEntry,
  type CustomCompanionGallery,
  type ThumbnailConsumer,
} from '../customCompanions/customCompanionTypes';
import type { MatrixCredentials } from './useMatrixClient';

const BRIDGE_REQUEST_TIMEOUT_MS = 15_000;
let nextCompanionRequestId = 1;

interface CompanionBridgeResponse {
  requestId?: number;
  success?: boolean;
  body?: string;
  statusCode?: number;
  error?: string;
}

function companionBridgeRequest(payload: Record<string, unknown>): Promise<unknown> {
  const requestId = nextCompanionRequestId++;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      bridge.off('companions.response', handleResponse);
      clearTimeout(timer);
    };
    const handleResponse = (data: unknown) => {
      const response = data as CompanionBridgeResponse;
      if (response.requestId !== requestId) return;
      cleanup();
      if (!response.success) {
        const error = new Error(response.error || `Companion request failed (${response.statusCode || 0}).`);
        Object.assign(error, { statusCode: response.statusCode, body: response.body });
        reject(error);
        return;
      }
      if (!response.body) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(response.body));
      } catch (error) {
        reject(error);
      }
    };
    bridge.on('companions.response', handleResponse);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Companion request timed out.'));
    }, BRIDGE_REQUEST_TIMEOUT_MS);
    bridge.send('companions.request', { ...payload, requestId });
  });
}

function redactionTarget(event: MatrixEvent): string | null {
  if (event.getType() !== 'm.room.redaction') return null;
  const redaction = event as MatrixEvent & {
    getRedacts?(): string | undefined;
    getContent(): { redacts?: string };
  };
  return redaction.getRedacts?.() ?? redaction.getContent().redacts ?? null;
}

export interface CustomCompanionGalleryController extends CustomCompanionGallery {
  requestAtlas(entry: CustomCompanionEntry, protectedKeys: ReadonlySet<string>): Promise<string>;
  requestThumbnail(entry: CustomCompanionEntry, consumer: ThumbnailConsumer): Promise<string>;
  releaseAtlas(entry: CustomCompanionEntry): void;
  releaseThumbnail(entry: CustomCompanionEntry, consumer: ThumbnailConsumer): void;
  createCompanion(name: string, mediaUri: string): Promise<unknown>;
  deleteCompanion(entry: CustomCompanionEntry): Promise<void>;
}

export function useCustomCompanionGallery(
  client: MatrixClient | null,
  credentials: MatrixCredentials | null,
): CustomCompanionGalleryController {
  const capability = credentials?.customCompanions;
  const accessToken = credentials?.accessToken;
  const [gallery, setGallery] = useState<CustomCompanionGallery>(() =>
    emptyGallery(capability ? 'loading' : 'disabled'));
  const loader = useMemo(
    () => client && capability && accessToken
      ? new CustomCompanionMediaLoader(client, { accessToken })
      : null,
    [accessToken, capability, client],
  );
  const galleryRef = useRef(gallery);
  const galleryScopeRef = useRef<{ client: MatrixClient; galleryRoomId: string } | null>(null);
  const atlasUrls = useRef(new Map<string, string>());
  const thumbnailUrls = useRef(new Map<string, string>());
  const atlasRequests = useRef(new Map<string, Promise<string>>());
  const thumbnailRequests = useRef(new Map<string, Promise<string>>());
  const thumbnailConsumers = useRef(new Map<string, Set<ThumbnailConsumer>>());
  galleryRef.current = gallery;

  const revokeUrl = useCallback((urls: Map<string, string>, cacheKey: string) => {
    const url = urls.get(cacheKey);
    if (url) URL.revokeObjectURL(url);
    urls.delete(cacheKey);
  }, []);

  const cleanupEntry = useCallback((cacheKey: string) => {
    loader?.cancel(cacheKey);
    atlasRequests.current.delete(cacheKey);
    thumbnailRequests.current.delete(cacheKey);
    thumbnailConsumers.current.delete(cacheKey);
    revokeUrl(atlasUrls.current, cacheKey);
    revokeUrl(thumbnailUrls.current, cacheKey);
    void deleteAtlas(cacheKey);
  }, [loader, revokeUrl]);

  useEffect(() => {
    if (!client || !capability) {
      galleryScopeRef.current = null;
      setGallery(emptyGallery('disabled'));
      return;
    }

    let active = true;
    const previousScope = galleryScopeRef.current;
    const sameScope = previousScope?.client === client
      && previousScope.galleryRoomId === capability.galleryRoomId;
    galleryScopeRef.current = { client, galleryRoomId: capability.galleryRoomId };
    let scopeRedactedEventIds = sameScope
      ? new Set(galleryRef.current.redactedEventIds)
      : new Set<string>();
    setGallery(emptyGallery('loading', new Set(scopeRedactedEventIds)));

    const applyRedaction = (eventId: string) => {
      scopeRedactedEventIds.add(eventId);
      const known = galleryRef.current.entries.find(entry => entry.eventId === eventId);
      cleanupEntry(known?.atlasCacheKey ?? `${capability.galleryRoomId}\u0000${eventId}`);
      setGallery(current => reduceGalleryEvent(current, { kind: 'remove', eventId }));
    };

    const applyEvent = (event: MatrixEvent) => {
      const target = redactionTarget(event);
      if (target) {
        applyRedaction(target);
        return;
      }
      const entry = parseCustomCompanionEvent(event, capability);
      if (entry) setGallery(current => reduceGalleryEvent(current, { kind: 'upsert', entry }));
      else if (event.getType() === 'im.brmble.sprite' && event.isRedacted?.() && event.getId()) {
        applyRedaction(event.getId()!);
      }
    };

    const readCurrentState = () => {
      try {
        const room = client.getRoom(capability.galleryRoomId);
        if (!room?.currentState) throw new Error('Custom companion gallery room is unavailable.');
        const current = emptyGallery('loading', new Set(scopeRedactedEventIds));
        const next = room.currentState.getStateEvents('im.brmble.sprite').reduce((state, event) => {
          if (event.isRedacted?.() && event.getId()) {
            cleanupEntry(`${capability.galleryRoomId}\u0000${event.getId()}`);
            return reduceGalleryEvent(state, { kind: 'remove', eventId: event.getId()! });
          }
          const entry = parseCustomCompanionEvent(event, capability);
          return entry ? reduceGalleryEvent(state, { kind: 'upsert', entry }) : state;
        }, current);
        scopeRedactedEventIds = new Set(next.redactedEventIds);
        if (active) setGallery({
          ...next,
          status: next.entries.length === 0 ? 'empty' : 'ready',
          error: null,
        });
      } catch (error) {
        if (active) setGallery({
          ...emptyGallery('unavailable', new Set(scopeRedactedEventIds)),
          error: error instanceof Error ? error.message : 'Custom companion gallery is unavailable.',
        });
      }
    };

    const onStateEvent = (event: MatrixEvent) => {
      if (event.getRoomId() === capability.galleryRoomId) applyEvent(event);
    };
    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      if ((room?.roomId ?? event.getRoomId()) === capability.galleryRoomId) applyEvent(event);
    };
    const onSync = (state: SyncState | string) => {
      if (state === SyncState.Prepared || state === SyncState.Syncing || state === 'PREPARED' || state === 'SYNCING') {
        readCurrentState();
      }
    };

    readCurrentState();
    client.on(RoomStateEvent.Events, onStateEvent);
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(ClientEvent.Sync, onSync);

    return () => {
      active = false;
      client.off(RoomStateEvent.Events, onStateEvent);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(ClientEvent.Sync, onSync);
    };
  }, [capability, cleanupEntry, client]);

  useEffect(() => () => {
    loader?.cancelAll();
    atlasUrls.current.forEach(url => URL.revokeObjectURL(url));
    thumbnailUrls.current.forEach(url => URL.revokeObjectURL(url));
    atlasUrls.current.clear();
    thumbnailUrls.current.clear();
    atlasRequests.current.clear();
    thumbnailRequests.current.clear();
    thumbnailConsumers.current.clear();
  }, [loader]);

  const requestAtlas = useCallback((entry: CustomCompanionEntry, protectedKeys: ReadonlySet<string>) => {
    if (!loader) return Promise.reject(new Error('Custom companion media is unavailable.'));
    if (galleryRef.current.redactedEventIds.has(entry.eventId)) {
      return Promise.reject(new Error('Custom companion was removed.'));
    }
    const existingUrl = atlasUrls.current.get(entry.atlasCacheKey);
    if (existingUrl) return Promise.resolve(existingUrl);
    const existingRequest = atlasRequests.current.get(entry.atlasCacheKey);
    if (existingRequest) return existingRequest;

    const request: Promise<string> = loader.ensureAtlas(entry, protectedKeys).then((blob): string | Promise<string> => {
      if (galleryRef.current.redactedEventIds.has(entry.eventId)) throw new Error('Custom companion was removed.');
      const owner = atlasRequests.current.get(entry.atlasCacheKey);
      if (owner !== request) {
        if (owner) return owner;
        throw new Error('Custom companion atlas request was cancelled.');
      }
      revokeUrl(atlasUrls.current, entry.atlasCacheKey);
      const url = URL.createObjectURL(blob);
      atlasUrls.current.set(entry.atlasCacheKey, url);
      return url;
    }).finally(() => {
      if (atlasRequests.current.get(entry.atlasCacheKey) === request) {
        atlasRequests.current.delete(entry.atlasCacheKey);
      }
    });
    atlasRequests.current.set(entry.atlasCacheKey, request);
    return request;
  }, [loader, revokeUrl]);

  const requestThumbnail = useCallback((entry: CustomCompanionEntry, consumer: ThumbnailConsumer) => {
    if (!loader) return Promise.reject(new Error('Custom companion media is unavailable.'));
    if (galleryRef.current.redactedEventIds.has(entry.eventId)) {
      return Promise.reject(new Error('Custom companion was removed.'));
    }
    const consumers = thumbnailConsumers.current.get(entry.atlasCacheKey) ?? new Set();
    consumers.add(consumer);
    thumbnailConsumers.current.set(entry.atlasCacheKey, consumers);
    const existingUrl = thumbnailUrls.current.get(entry.atlasCacheKey);
    if (existingUrl) return Promise.resolve(existingUrl);
    const existingRequest = thumbnailRequests.current.get(entry.atlasCacheKey);
    if (existingRequest) return existingRequest;

    const controller = new AbortController();
    const request: Promise<string> = loader.loadThumbnail(entry, controller.signal).then((blob): string | Promise<string> => {
      if (galleryRef.current.redactedEventIds.has(entry.eventId)) throw new Error('Custom companion was removed.');
      const owner = thumbnailRequests.current.get(entry.atlasCacheKey);
      if (owner !== request) {
        if (owner) return owner;
        throw new Error('Custom companion thumbnail request was cancelled.');
      }
      revokeUrl(thumbnailUrls.current, entry.atlasCacheKey);
      const url = URL.createObjectURL(blob);
      thumbnailUrls.current.set(entry.atlasCacheKey, url);
      return url;
    }).finally(() => {
      if (thumbnailRequests.current.get(entry.atlasCacheKey) === request) {
        thumbnailRequests.current.delete(entry.atlasCacheKey);
      }
    });
    thumbnailRequests.current.set(entry.atlasCacheKey, request);
    return request;
  }, [loader, revokeUrl]);

  const releaseAtlas = useCallback((entry: CustomCompanionEntry) => {
    loader?.cancelAtlas(entry.atlasCacheKey);
    atlasRequests.current.delete(entry.atlasCacheKey);
    revokeUrl(atlasUrls.current, entry.atlasCacheKey);
  }, [loader, revokeUrl]);

  const releaseThumbnail = useCallback((entry: CustomCompanionEntry, consumer: ThumbnailConsumer) => {
    const consumers = thumbnailConsumers.current.get(entry.atlasCacheKey);
    if (!consumers?.delete(consumer)) return;
    if (consumers.size > 0) return;
    thumbnailConsumers.current.delete(entry.atlasCacheKey);
    loader?.cancelThumbnail(entry.atlasCacheKey);
    thumbnailRequests.current.delete(entry.atlasCacheKey);
    revokeUrl(thumbnailUrls.current, entry.atlasCacheKey);
  }, [loader, revokeUrl]);

  const createCompanion = useCallback(
    (name: string, mediaUri: string) => companionBridgeRequest({ action: 'create', name, mediaUri }),
    [],
  );
  const deleteCompanion = useCallback(async (entry: CustomCompanionEntry) => {
    await companionBridgeRequest({ action: 'delete', eventId: entry.eventId });
  }, []);

  return {
    ...gallery,
    requestAtlas,
    requestThumbnail,
    releaseAtlas,
    releaseThumbnail,
    createCompanion,
    deleteCompanion,
  };
}
