import type { MatrixClient } from 'matrix-js-sdk';
import { deleteAtlasIfOwned, getAtlas, putAtlas } from './customCompanionAtlasStore';
import type { CustomCompanionEntry } from './customCompanionTypes';
import type { MatrixCredentials } from '../hooks/useMatrixClient';

const MAX_ATLAS_BYTES = 5 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;

interface InFlightRequest {
  promise: Promise<Blob>;
  controller: AbortController;
}

function abortError(): DOMException {
  return new DOMException('The custom companion request was cancelled.', 'AbortError');
}

function createWriteOwner(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

async function readBoundedBlob(response: Response, maxBytes: number, mimeType: string): Promise<Blob> {
  if (!response.ok) throw new Error(`Custom companion media request failed (${response.status}).`);

  if (!response.body) {
    throw new Error('Custom companion media stream is unavailable.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    byteSize += value.byteLength;
    if (byteSize > maxBytes) {
      await reader.cancel();
      throw new Error('Custom companion media is too large.');
    }
    chunks.push(new Uint8Array(value));
  }
  return new Blob(chunks.map(chunk => chunk.buffer as ArrayBuffer), { type: mimeType });
}

function mediaUrl(
  client: Pick<MatrixClient, 'mxcUrlToHttp'>,
  entry: CustomCompanionEntry,
  thumbnail: boolean,
): string {
  const url = thumbnail
    ? client.mxcUrlToHttp(entry.mediaUri, 192, 234, 'scale', false, true, true)
    : client.mxcUrlToHttp(entry.mediaUri, undefined, undefined, undefined, false, true, true);
  if (!url) throw new Error('Custom companion media URL is unavailable.');
  return url;
}

export class CustomCompanionMediaLoader {
  private readonly atlasRequests = new Map<string, InFlightRequest>();
  private readonly thumbnailRequests = new Map<string, InFlightRequest>();
  private readonly generations = new Map<string, number>();
  private readonly client: Pick<MatrixClient, 'mxcUrlToHttp'>;
  private readonly credentials: Pick<MatrixCredentials, 'accessToken'>;

  constructor(
    client: Pick<MatrixClient, 'mxcUrlToHttp'>,
    credentials: Pick<MatrixCredentials, 'accessToken'>,
  ) {
    this.client = client;
    this.credentials = credentials;
  }

  ensureAtlas(
    entry: CustomCompanionEntry,
    protectedKeys: ReadonlySet<string>,
  ): Promise<Blob> {
    const existing = this.atlasRequests.get(entry.atlasCacheKey);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const generation = this.generations.get(entry.atlasCacheKey) ?? 0;
    const writeOwner = createWriteOwner();
    const promise = (async () => {
      const cached = await getAtlas(entry.atlasCacheKey);
      if (controller.signal.aborted || (this.generations.get(entry.atlasCacheKey) ?? 0) !== generation) throw abortError();
      if (cached) return cached;

      const response = await fetch(mediaUrl(this.client, entry, false), {
        headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
        signal: controller.signal,
      });
      const blob = await readBoundedBlob(response, MAX_ATLAS_BYTES, entry.mimeType);
      if (controller.signal.aborted || (this.generations.get(entry.atlasCacheKey) ?? 0) !== generation) throw abortError();
      const normalized = blob.slice(0, blob.size, entry.mimeType);
      await putAtlas(entry.atlasCacheKey, normalized, protectedKeys, writeOwner);
      if (controller.signal.aborted || (this.generations.get(entry.atlasCacheKey) ?? 0) !== generation) {
        await deleteAtlasIfOwned(entry.atlasCacheKey, writeOwner);
        throw abortError();
      }
      return normalized;
    })().finally(() => {
      if (this.atlasRequests.get(entry.atlasCacheKey)?.promise === promise) {
        this.atlasRequests.delete(entry.atlasCacheKey);
      }
    });
    this.atlasRequests.set(entry.atlasCacheKey, { promise, controller });
    return promise;
  }

  loadThumbnail(entry: CustomCompanionEntry, signal: AbortSignal): Promise<Blob> {
    const existing = this.thumbnailRequests.get(entry.atlasCacheKey);
    if (existing) {
      const onAbort = () => existing.controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      return existing.promise.finally(() => signal.removeEventListener('abort', onAbort));
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();

    const promise = (async () => {
      const response = await fetch(mediaUrl(this.client, entry, true), {
        headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
        signal: controller.signal,
      });
      const responseType = response.headers.get('Content-Type')?.split(';')[0];
      const mimeType = responseType === 'image/png' || responseType === 'image/webp'
        ? responseType
        : entry.mimeType;
      const blob = await readBoundedBlob(response, MAX_THUMBNAIL_BYTES, mimeType);
      if (controller.signal.aborted) throw abortError();
      return blob;
    })().finally(() => {
      signal.removeEventListener('abort', onAbort);
      if (this.thumbnailRequests.get(entry.atlasCacheKey)?.promise === promise) {
        this.thumbnailRequests.delete(entry.atlasCacheKey);
      }
    });
    this.thumbnailRequests.set(entry.atlasCacheKey, { promise, controller });
    return promise;
  }

  cancelAtlas(cacheKey: string): void {
    this.atlasRequests.get(cacheKey)?.controller.abort();
    this.generations.set(cacheKey, (this.generations.get(cacheKey) ?? 0) + 1);
  }

  cancelThumbnail(cacheKey: string): void {
    this.thumbnailRequests.get(cacheKey)?.controller.abort();
  }

  cancel(cacheKey: string): void {
    this.cancelAtlas(cacheKey);
    this.cancelThumbnail(cacheKey);
  }

  cancelAll(): void {
    for (const cacheKey of new Set([
      ...this.atlasRequests.keys(),
      ...this.thumbnailRequests.keys(),
    ])) {
      this.cancel(cacheKey);
    }
  }
}
