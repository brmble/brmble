import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomCompanionMediaLoader } from './customCompanionMediaLoader';
import type { CustomCompanionEntry } from './customCompanionTypes';

const { deleteAtlas, getAtlas, putAtlas } = vi.hoisted(() => ({
  deleteAtlas: vi.fn(),
  getAtlas: vi.fn(),
  putAtlas: vi.fn(),
}));
vi.mock('./customCompanionAtlasStore', () => ({ deleteAtlas, getAtlas, putAtlas }));

const entry: CustomCompanionEntry = {
  id: 'custom:$sprite:test',
  eventId: '$sprite:test',
  roomId: '!gallery:test',
  name: 'Orbit',
  mediaUri: 'mxc://test/orbit',
  mimeType: 'image/png',
  width: 800,
  height: 900,
  frameCount: 1,
  byteSize: 4096,
  uploaderMatrixUserId: '@alice:test',
  uploaderDisplayName: 'Alice',
  createdAt: 1,
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

function streamingResponse(chunks: Uint8Array[], type = '') {
  let index = 0;
  const cancel = vi.fn();
  return {
    ok: true,
    status: 200,
    headers: new Headers(type ? { 'Content-Type': type } : {}),
    body: {
      getReader: () => ({
        read: vi.fn(async () => index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined }),
        cancel,
      }),
    },
    cancel,
  };
}

describe('CustomCompanionMediaLoader', () => {
  const client = {
    mxcUrlToHttp: vi.fn(() => 'https://matrix.test/media'),
  };
  const makeLoader = () => new CustomCompanionMediaLoader(client, { accessToken: 'token' });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    getAtlas.mockReset();
    deleteAtlas.mockReset().mockResolvedValue(undefined);
    putAtlas.mockReset().mockResolvedValue(true);
    client.mxcUrlToHttp.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns a persistent hit and refreshes through getAtlas without fetching', async () => {
    const cached = new Blob(['cached'], { type: 'image/png' });
    getAtlas.mockResolvedValue(cached);
    const loader = makeLoader();

    await expect(loader.ensureAtlas(entry, new Set())).resolves.toBe(cached);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent full misses and persists a normalized blob', async () => {
    getAtlas.mockResolvedValue(undefined);
    let resolveFetch!: (value: unknown) => void;
    const response = streamingResponse([new Uint8Array([1, 2, 3])], 'application/octet-stream');
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(resolve => {
      resolveFetch = value => resolve(value as Response);
    }));
    const loader = makeLoader();
    const protectedKeys = new Set(['rendered']);

    const first = loader.ensureAtlas(entry, protectedKeys);
    const second = loader.ensureAtlas(entry, protectedKeys);
    resolveFetch(response);
    const [firstBlob, secondBlob] = await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://matrix.test/media', expect.objectContaining({
      headers: { Authorization: 'Bearer token' },
    }));
    expect(client.mxcUrlToHttp).toHaveBeenCalledWith(
      entry.mediaUri, undefined, undefined, undefined, false, true, true,
    );
    expect(firstBlob).toBe(secondBlob);
    expect(firstBlob.type).toBe('image/png');
    expect(putAtlas).toHaveBeenCalledWith(entry.atlasCacheKey, firstBlob, protectedKeys);
  });

  it('stops reading and rejects a full atlas above 5 MiB', async () => {
    getAtlas.mockResolvedValue(undefined);
    const response = streamingResponse([
      new Uint8Array(5 * 1024 * 1024),
      new Uint8Array(1),
    ]);
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);
    const loader = makeLoader();

    await expect(loader.ensureAtlas(entry, new Set())).rejects.toThrow('too large');
    expect(response.cancel).toHaveBeenCalled();
    expect(putAtlas).not.toHaveBeenCalled();
  });

  it('loads only the bounded authenticated thumbnail with the supplied signal', async () => {
    const response = streamingResponse([new Uint8Array([1, 2, 3])], 'image/webp');
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);
    const loader = makeLoader();
    const controller = new AbortController();

    const thumbnail = await loader.loadThumbnail(entry, controller.signal);

    expect(thumbnail.size).toBe(3);
    expect(client.mxcUrlToHttp).toHaveBeenCalledWith(
      entry.mediaUri, 192, 234, 'scale', false, true, true,
    );
    expect(fetch).toHaveBeenCalledWith('https://matrix.test/media', expect.objectContaining({
      headers: { Authorization: 'Bearer token' },
      signal: expect.any(AbortSignal),
    }));
    expect(putAtlas).not.toHaveBeenCalled();
  });

  it('rejects thumbnails above 1 MiB without falling back to a full request', async () => {
    const response = streamingResponse([
      new Uint8Array(1024 * 1024),
      new Uint8Array(1),
    ]);
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);
    const loader = makeLoader();

    await expect(loader.loadThumbnail(entry, new AbortController().signal)).rejects.toThrow('too large');
    expect(client.mxcUrlToHttp).toHaveBeenCalledTimes(1);
    expect(putAtlas).not.toHaveBeenCalled();
  });

  it('clears failed in-flight work so a later explicit request retries', async () => {
    getAtlas.mockResolvedValue(undefined);
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(streamingResponse([new Uint8Array([1])]) as unknown as Response);
    const loader = makeLoader();

    await expect(loader.ensureAtlas(entry, new Set())).rejects.toThrow('offline');
    await expect(loader.ensureAtlas(entry, new Set())).resolves.toHaveProperty('size', 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels a redacted full request before it can persist', async () => {
    getAtlas.mockResolvedValue(undefined);
    let resolveFetch!: (value: unknown) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(resolve => {
      resolveFetch = value => resolve(value as Response);
    }));
    const loader = makeLoader();
    const pending = loader.ensureAtlas(entry, new Set());

    loader.cancel(entry.atlasCacheKey);
    resolveFetch(streamingResponse([new Uint8Array([1])]));

    await expect(pending).rejects.toThrow();
    expect(putAtlas).not.toHaveBeenCalled();
  });

  it('removes an atlas when redaction arrives during its pending cache write', async () => {
    getAtlas.mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(streamingResponse([new Uint8Array([1])]) as unknown as Response);
    let finishWrite!: () => void;
    putAtlas.mockReturnValue(new Promise(resolve => { finishWrite = () => resolve(true); }));
    const loader = makeLoader();
    const pending = loader.ensureAtlas(entry, new Set());
    await vi.waitFor(() => expect(putAtlas).toHaveBeenCalled());

    loader.cancel(entry.atlasCacheKey);
    finishWrite();

    await expect(pending).rejects.toThrow();
    expect(deleteAtlas).toHaveBeenCalledWith(entry.atlasCacheKey);
  });
});
