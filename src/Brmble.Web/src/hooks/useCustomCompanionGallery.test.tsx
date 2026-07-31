import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MatrixCredentials } from './useMatrixClient';
import { useCustomCompanionGallery } from './useCustomCompanionGallery';
import bridge from '../bridge';
import type {
  AtlasStoreAdapter,
  AtlasStoreTransaction,
  StoredAtlas,
} from '../customCompanions/customCompanionAtlasStore';

const NativeUrl = globalThis.URL;

const {
  deleteAtlas,
  ensureAtlas,
  loadThumbnail,
  cancel,
  cancelAll,
  cancelAtlas,
  cancelThumbnail,
} = vi.hoisted(() => ({
  deleteAtlas: vi.fn(),
  ensureAtlas: vi.fn(),
  loadThumbnail: vi.fn(),
  cancel: vi.fn(),
  cancelAll: vi.fn(),
  cancelAtlas: vi.fn(),
  cancelThumbnail: vi.fn(),
}));
vi.mock('../customCompanions/customCompanionAtlasStore', () => ({
  deleteAtlas,
}));

vi.mock('../customCompanions/customCompanionMediaLoader', () => ({
  CustomCompanionMediaLoader: vi.fn(function MockMediaLoader() {
    return { ensureAtlas, loadThumbnail, cancel, cancelAll, cancelAtlas, cancelThumbnail };
  }),
}));

type Handler = (...args: unknown[]) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class InMemoryAtlasAdapter implements AtlasStoreAdapter {
  private records = new Map<string, StoredAtlas>();
  private tail = Promise.resolve();

  transaction<T>(work: (transaction: AtlasStoreTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const copy = new Map(
        [...this.records].map(([key, value]) => [key, { ...value }]),
      );
      const transaction: AtlasStoreTransaction = {
        get: async key => copy.get(key),
        getAll: async () => [...copy.values()],
        put: async record => { copy.set(record.cacheKey, record); },
        delete: async key => { copy.delete(key); },
      };
      const result = await work(transaction);
      this.records = copy;
      return result;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  snapshot(): StoredAtlas[] {
    return [...this.records.values()];
  }
}

function event(index: number, overrides: Record<string, unknown> = {}) {
  const raw = {
    type: 'im.brmble.sprite',
    eventId: `$sprite-${index}:test`,
    roomId: '!gallery:test',
    sender: '@brmble:test',
    createdAt: index,
    content: {
      schemaVersion: 1,
      name: `Sprite ${index}`,
      mediaUri: `mxc://test/${index}`,
      mimeType: 'image/png',
      width: 800,
      height: 900,
      frameCount: 1,
      byteSize: 4096,
      uploaderMatrixUserId: '@alice:test',
      uploaderDisplayName: 'Alice',
    },
    ...overrides,
  };
  return {
    ...raw,
    getType: () => raw.type,
    getId: () => raw.eventId,
    getRoomId: () => raw.roomId,
    getSender: () => raw.sender,
    getTs: () => raw.createdAt,
    getContent: () => raw.content,
    getRedacts: () => (raw as { redacts?: string }).redacts,
    isRedacted: () => Boolean((raw as { redacted?: boolean }).redacted),
  };
}

function setupClient(initialEvents = Array.from({ length: 100 }, (_, index) => event(index))) {
  const handlers = new Map<string, Set<Handler>>();
  const room = {
    currentState: {
      getStateEvents: vi.fn(() => initialEvents),
    },
  };
  const client = {
    getRoom: vi.fn<() => typeof room | null>(() => room),
    on: vi.fn((name: string, handler: Handler) => {
      const current = handlers.get(name) ?? new Set();
      current.add(handler);
      handlers.set(name, current);
    }),
    off: vi.fn((name: string, handler: Handler) => handlers.get(name)?.delete(handler)),
    mxcUrlToHttp: vi.fn((uri: string) => `https://matrix.test/${encodeURIComponent(uri)}`),
  };
  return {
    client,
    room,
    emit(name: string, ...args: unknown[]) {
      handlers.get(name)?.forEach(handler => handler(...args));
    },
  };
}

function asMatrixClient(client: ReturnType<typeof setupClient>['client']): MatrixClient {
  return client as unknown as MatrixClient;
}

const credentials: MatrixCredentials = {
  homeserverUrl: 'https://matrix.test',
  accessToken: 'token',
  userId: '@me:test',
  roomMap: {},
  customCompanions: {
    enabled: true,
    schemaVersion: 1,
    galleryRoomId: '!gallery:test',
    trustedSender: '@brmble:test',
    canModerate: true,
    selectedCompanionId: 'floppy',
    maxActivePerUser: 10,
    maxActiveTotal: 100,
  },
};

describe('useCustomCompanionGallery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
    deleteAtlas.mockReset().mockResolvedValue(undefined);
    ensureAtlas.mockReset();
    loadThumbnail.mockReset();
    cancel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as Window & { chrome?: unknown }).chrome;
  });

  it('synchronizes metadata without requesting any media', async () => {
    const { client } = setupClient();
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(client), credentials));

    await waitFor(() => expect(result.current.entries).toHaveLength(100));
    expect(result.current.status).toBe('ready');
    expect(fetch).not.toHaveBeenCalled();
    expect(ensureAtlas).not.toHaveBeenCalled();
    expect(loadThumbnail).not.toHaveBeenCalled();
  });

  it('downloads one full atlas only for the selected row in a 100-entry gallery', async () => {
    const { client } = setupClient();
    ensureAtlas.mockResolvedValue(new Blob(['selected-atlas']));
    const { result } = renderHook(() =>
      useCustomCompanionGallery(asMatrixClient(client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(100));

    const selected = result.current.entries[73];
    await expect(result.current.requestAtlas(selected, new Set())).resolves.toBe('blob:14');

    expect(ensureAtlas).toHaveBeenCalledOnce();
    expect(ensureAtlas).toHaveBeenCalledWith(selected, new Set());
    expect(loadThumbnail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reuses a persistent atlas after restart and evicts the oldest unprotected record', async () => {
    vi.stubGlobal('URL', NativeUrl);
    const { CustomCompanionAtlasStore } = await vi.importActual<
      typeof import('../customCompanions/customCompanionAtlasStore')
    >('../customCompanions/customCompanionAtlasStore');
    const adapter = new InMemoryAtlasAdapter();
    const maxBytes = 104_857_600;
    const fixture = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/png' });
    let now = 0;
    const firstSession = new CustomCompanionAtlasStore(adapter, maxBytes, () => ++now);
    for (let index = 0; index < 20; index += 1) {
      await firstSession.putAtlas(`atlas-${index}`, fixture, new Set());
    }

    const reopened = new CustomCompanionAtlasStore(adapter, maxBytes, () => ++now);
    await expect(reopened.getAtlas('atlas-0')).resolves.toHaveProperty(
      'size',
      5 * 1024 * 1024,
    );
    expect(fetch).not.toHaveBeenCalled();

    await expect(
      reopened.putAtlas('atlas-20', fixture, new Set(['atlas-0'])),
    ).resolves.toBe(true);
    const remaining = adapter.snapshot();
    expect(remaining.reduce((total, record) => total + record.byteSize, 0))
      .toBeLessThanOrEqual(maxBytes);
    expect(remaining.map(record => record.cacheKey)).toContain('atlas-0');
    expect(remaining.map(record => record.cacheKey)).not.toContain('atlas-1');
  });

  it('re-reads complete current state on sync and converges duplicate delivery', async () => {
    const harness = setupClient([event(1)]);
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => harness.emit('Room.timeline', event(1), { roomId: '!gallery:test' }));
    expect(result.current.entries).toHaveLength(1);

    harness.room.currentState.getStateEvents.mockReturnValue([event(1), event(2)]);
    act(() => harness.emit('sync', 'SYNCING'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores gallery events delivered from the wrong room', async () => {
    const harness = setupClient([event(1)]);
    const { result } = renderHook(() =>
      useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => harness.emit(
      'Room.timeline',
      event(2, { roomId: '!other:test' }),
      { roomId: '!other:test' },
    ));

    expect(result.current.entries.map(entry => entry.eventId)).toEqual(['$sprite-1:test']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a tombstone for redaction-before-addition', async () => {
    const harness = setupClient([]);
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    act(() => harness.emit('Room.timeline', event(99, {
      type: 'm.room.redaction',
      eventId: '$redaction:test',
      redacts: '$sprite-1:test',
      content: {},
    }), { roomId: '!gallery:test' }));
    act(() => harness.emit('Room.timeline', event(1), { roomId: '!gallery:test' }));

    expect(result.current.entries).toEqual([]);
    expect(result.current.redactedEventIds).toContain('$sprite-1:test');
  });

  it('does not carry redaction tombstones into a different gallery scope', async () => {
    const oldGallery = setupClient([]);
    const hook = renderHook(
      ({ client, currentCredentials }) => useCustomCompanionGallery(client, currentCredentials),
      {
        initialProps: {
          client: asMatrixClient(oldGallery.client),
          currentCredentials: credentials,
        },
      },
    );
    await waitFor(() => expect(hook.result.current.status).toBe('empty'));

    act(() => oldGallery.emit('Room.timeline', event(99, {
      type: 'm.room.redaction',
      eventId: '$redaction:test',
      redacts: '$sprite-1:test',
      content: {},
    }), { roomId: '!gallery:test' }));
    expect(hook.result.current.redactedEventIds).toContain('$sprite-1:test');

    const newGallery = setupClient([event(1, { roomId: '!other:test' })]);
    hook.rerender({
      client: asMatrixClient(newGallery.client),
      currentCredentials: {
        ...credentials,
        customCompanions: {
          ...credentials.customCompanions!,
          galleryRoomId: '!other:test',
        },
      },
    });

    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    expect(hook.result.current.entries[0].eventId).toBe('$sprite-1:test');
    expect(hook.result.current.redactedEventIds).not.toContain('$sprite-1:test');
  });

  it('cancels requests, revokes URLs, and deletes the cached atlas on redaction', async () => {
    const harness = setupClient([event(1)]);
    ensureAtlas.mockResolvedValue(new Blob(['atlas']));
    loadThumbnail.mockResolvedValue(new Blob(['thumb']));
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => {
      await result.current.requestAtlas(result.current.entries[0], new Set());
      await result.current.requestThumbnail(result.current.entries[0], Symbol('redaction-test'));
    });
    act(() => harness.emit('Room.timeline', event(99, {
      type: 'm.room.redaction',
      eventId: '$redaction:test',
      redacts: '$sprite-1:test',
      content: {},
    }), { roomId: '!gallery:test' }));

    await waitFor(() => expect(deleteAtlas).toHaveBeenCalledWith('!gallery:test\u0000$sprite-1:test'));
    expect(cancel).toHaveBeenCalledWith('!gallery:test\u0000$sprite-1:test');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('keeps replacement atlas request ownership when a stale request completes', async () => {
    const harness = setupClient([event(1)]);
    const staleBlob = deferred<Blob>();
    const currentBlob = deferred<Blob>();
    ensureAtlas.mockReturnValueOnce(staleBlob.promise).mockReturnValue(currentBlob.promise);
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:current-atlas');
    const hook = renderHook(
      ({ currentCredentials }) => useCustomCompanionGallery(
        asMatrixClient(harness.client),
        currentCredentials,
      ),
      { initialProps: { currentCredentials: credentials } },
    );
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    const entry = hook.result.current.entries[0];

    const staleRequest = hook.result.current.requestAtlas(entry, new Set());
    hook.rerender({
      currentCredentials: { ...credentials, accessToken: 'replacement-token' },
    });
    const currentRequest = hook.result.current.requestAtlas(entry, new Set());
    expect(ensureAtlas).toHaveBeenCalledTimes(2);

    staleBlob.resolve(new Blob(['stale']));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const attachedRequest = hook.result.current.requestAtlas(entry, new Set());
    expect(attachedRequest).toBe(currentRequest);
    expect(ensureAtlas).toHaveBeenCalledTimes(2);

    currentBlob.resolve(new Blob(['current']));
    await expect(Promise.all([staleRequest, currentRequest, attachedRequest])).resolves.toEqual([
      'blob:current-atlas',
      'blob:current-atlas',
      'blob:current-atlas',
    ]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps replacement thumbnail request ownership when a stale request completes', async () => {
    const harness = setupClient([event(1)]);
    const staleBlob = deferred<Blob>();
    const currentBlob = deferred<Blob>();
    loadThumbnail.mockReturnValueOnce(staleBlob.promise).mockReturnValue(currentBlob.promise);
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:current-thumbnail');
    const hook = renderHook(
      ({ currentCredentials }) => useCustomCompanionGallery(
        asMatrixClient(harness.client),
        currentCredentials,
      ),
      { initialProps: { currentCredentials: credentials } },
    );
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    const entry = hook.result.current.entries[0];
    const consumer = Symbol('replacement-test');

    const staleRequest = hook.result.current.requestThumbnail(entry, consumer);
    hook.rerender({
      currentCredentials: { ...credentials, accessToken: 'replacement-token' },
    });
    const currentRequest = hook.result.current.requestThumbnail(entry, consumer);
    expect(loadThumbnail).toHaveBeenCalledTimes(2);

    staleBlob.resolve(new Blob(['stale']));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const attachedRequest = hook.result.current.requestThumbnail(entry, consumer);
    expect(attachedRequest).toBe(currentRequest);
    expect(loadThumbnail).toHaveBeenCalledTimes(2);

    currentBlob.resolve(new Blob(['current']));
    await expect(Promise.all([staleRequest, currentRequest, attachedRequest])).resolves.toEqual([
      'blob:current-thumbnail',
      'blob:current-thumbnail',
      'blob:current-thumbnail',
    ]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('retains a shared thumbnail until the final consumer releases it', async () => {
    const harness = setupClient([event(1)]);
    const thumbnailBlob = deferred<Blob>();
    loadThumbnail.mockReturnValue(thumbnailBlob.promise);
    cancelThumbnail.mockReset();
    const { result } = renderHook(() =>
      useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const currentEntry = result.current.entries[0];
    const pickerConsumer = Symbol('picker');
    const moderationConsumer = Symbol('moderation');

    const pickerRequest = result.current.requestThumbnail(currentEntry, pickerConsumer);
    const moderationRequest = result.current.requestThumbnail(currentEntry, moderationConsumer);
    expect(loadThumbnail).toHaveBeenCalledTimes(1);

    act(() => result.current.releaseThumbnail(currentEntry, pickerConsumer));
    expect(cancelThumbnail).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    thumbnailBlob.resolve(new Blob(['thumb']));
    await expect(Promise.all([pickerRequest, moderationRequest])).resolves.toEqual([
      'blob:5',
      'blob:5',
    ]);

    await expect(
      result.current.requestThumbnail(currentEntry, moderationConsumer),
    ).resolves.toBe('blob:5');
    expect(loadThumbnail).toHaveBeenCalledTimes(1);

    act(() => result.current.releaseThumbnail(currentEntry, moderationConsumer));
    expect(cancelThumbnail).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('exposes explicit media requests and retries failures only on demand', async () => {
    const harness = setupClient([event(1)]);
    ensureAtlas.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Blob(['atlas']));
    loadThumbnail.mockResolvedValue(new Blob(['thumb']));
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await expect(result.current.requestAtlas(result.current.entries[0], new Set())).rejects.toThrow('offline');
    expect(ensureAtlas).toHaveBeenCalledTimes(1);
    await expect(result.current.requestAtlas(result.current.entries[0], new Set())).resolves.toBe('blob:5');
    await expect(
      result.current.requestThumbnail(result.current.entries[0], Symbol('explicit-request-test')),
    ).resolves.toBe('blob:5');
  });

  it('reports disabled and unavailable states without media requests', async () => {
    const harness = setupClient([]);
    const disabled = renderHook(() => useCustomCompanionGallery(
      asMatrixClient(harness.client),
      { ...credentials, customCompanions: undefined },
    ));
    expect(disabled.result.current.status).toBe('disabled');

    harness.client.getRoom.mockReturnValue(null);
    const unavailable = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(unavailable.result.current.status).toBe('unavailable'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates gallery metadata through the correlated native bridge request', async () => {
    const harness = setupClient([]);
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    const pending = result.current.createCompanion('Orbit', 'mxc://test/orbit');
    const sent = postMessage.mock.calls[0][0];
    expect(sent).toMatchObject({
      type: 'companions.request',
      data: { action: 'create', name: 'Orbit', mediaUri: 'mxc://test/orbit' },
    });
    act(() => bridge._handleMessage({ data: {
      type: 'companions.response',
      data: { requestId: sent.data.requestId, success: true, body: '{"eventId":"$sprite:test"}' },
    } }));

    await expect(pending).resolves.toEqual({ eventId: '$sprite:test' });
  });

  it('deletes gallery metadata by event ID through the native bridge', async () => {
    const harness = setupClient([event(1)]);
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    const pending = result.current.deleteCompanion(result.current.entries[0]);
    const sent = postMessage.mock.calls[0][0];
    expect(sent).toMatchObject({
      type: 'companions.request',
      data: { action: 'delete', eventId: '$sprite-1:test' },
    });
    act(() => bridge._handleMessage({ data: {
      type: 'companions.response',
      data: { requestId: sent.data.requestId, success: true, statusCode: 204 },
    } }));

    await expect(pending).resolves.toBeUndefined();
  });
});
